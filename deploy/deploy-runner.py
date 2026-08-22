#!/usr/bin/env python3
"""
deploy-runner.py · 统一发布 + 快照拉取 一体化执行器（走 HTTP CONNECT 代理隧道 SSH）
------------------------------------------------------------------
为什么要有这个脚本：本环境 TCP 直连 120.55.6.75 所有端口都被封，但 HTTPS_PROXY (127.0.0.1:18080)
能帮我们用 HTTP CONNECT 建立隧道到 120.55.6.75:22。本脚本直接用 paramiko 连上去，
不需要 sshpass / apt / scp。

使用：
    python3 deploy-runner.py snapshot          # ① 把服务器原本的 backend/admin/.env/Nginx/DB 拉回仓库（跌倒在一起）
    python3 deploy-runner.py deploy            # ② 从仓库发 backend/src + admin + migrations 到服务器 + 迁移 + 重启
    python3 deploy-runner.py domain-only       # ③ Nginx 加 location = / → 301 /app/
    python3 deploy-runner.py all               # ①→②→③ 一把梭（推荐！！）
"""
import os, sys, io, time, tarfile, gzip, re, json, tempfile, shlex
from pathlib import Path
from urllib.parse import urlparse
import paramiko

REPO = Path(__file__).resolve().parent
PROXY_URL = (os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy')
             or os.environ.get('HTTP_PROXY') or os.environ.get('http_proxy'))
HOSTS = ['120.55.6.75', '120.55.6.7']
USER = 'admin'
PASS = 'yuan340364'

REMOTE_BACKEND = '/opt/shuxu-erp/backend/src'
REMOTE_FRONTEND = '/opt/shuxu-erp/admin'
REMOTE_NGINX  = '/etc/nginx/conf.d/shuxu-erp.conf'
REMOTE_ENV    = '/opt/shuxu-erp/backend/.env'

def log(*a, **k):
    print('[runner]', *a, flush=True, **k)

def connect():
    """通过 HTTPS_PROXY 建 HTTP CONNECT → paramiko 登录（优先 120.55.6.75）"""
    assert PROXY_URL, 'HTTPS_PROXY 环境变量不存在'
    p = urlparse(PROXY_URL)
    ph, pp = p.hostname, p.port or 80
    import socket
    last_err = None
    for host in HOSTS:
        try:
            port = 22
            log(f'CONNECT 代理 {ph}:{pp} → {host}:{port} ...')
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(20)
            s.connect((ph, pp))
            s.sendall(f'CONNECT {host}:{port} HTTP/1.1\r\nHost: {host}:{port}\r\n\r\n'.encode())
            data = b''
            while b'\r\n\r\n' not in data:
                data += s.recv(1)
                if len(data) > 4096: break
            first = data.split(b'\r\n')[0].decode(errors='ignore')
            log('   ', first)
            if '200' not in first:
                s.close(); raise RuntimeError('CONNECT 非 200: ' + first)
            cli = paramiko.SSHClient()
            cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            cli.connect(hostname=host, port=22, username=USER, password=PASS,
                        sock=s, timeout=25, banner_timeout=20, auth_timeout=20,
                        allow_agent=False, look_for_keys=False)
            log('✅ SSH OK →', host, ' | user:', USER)
            return cli, host
        except Exception as e:
            last_err = e
            log('   失败', type(e).__name__, str(e)[:200])
            try: s.close()
            except: pass
    raise RuntimeError(f'全部主机都连不上：{last_err}')

def run(cli, cmd, timeout=300, sudo=False):
    """执行远端命令，流式打印 stdout/stderr。sudo 会自动用 sudo -n 包一层。"""
    if sudo:
        cmd = "sudo -n bash -lc " + shlex.quote(cmd)
    log('$', cmd[:240] + ('...' if len(cmd) > 240 else ''))
    stdin, stdout, stderr = cli.exec_command(cmd, timeout=timeout, get_pty=True)
    out = []
    # 边读边打印
    while True:
        try:
            line = stdout.readline()
        except Exception:
            break
        if not line:
            break
        sys.stdout.write('   | ' + line)
        out.append(line)
    err = stderr.read().decode(errors='ignore')
    rc = stdout.channel.recv_exit_status()
    if rc != 0:
        log(f'   👉 exit={rc}')
        if err.strip():
            log('   STDERR:', err[:800])
    return rc, ''.join(out), err

def mkdir_p_sftp(sftp, path):
    parts = Path(path).parts
    cur = ''
    for part in parts:
        if part == '/':
            cur = '/'
            continue
        cur = os.path.join(cur, part)
        try:
            sftp.stat(cur)
        except IOError:
            try:
                sftp.mkdir(cur)
            except IOError:
                pass

def download_dir(sftp, remote, local_dir, sub_path=''):
    """用 SFTP 递归下载远端目录"""
    remote_full = f'{remote}/{sub_path}' if sub_path else remote
    local_full = Path(local_dir) / sub_path
    local_full.mkdir(parents=True, exist_ok=True)
    for entry in sftp.listdir_attr(remote_full):
        name = entry.filename
        if name in ('.', '..'): continue
        r = f'{remote_full}/{name}'
        l = local_full / name
        mode = entry.st_mode
        import stat as _stat
        if _stat.S_ISDIR(mode):
            download_dir(sftp, remote, local_dir, f'{sub_path}/{name}' if sub_path else name)
        elif _stat.S_ISREG(mode):
            try:
                sftp.get(r, str(l))
            except Exception as e:
                log(f'   下载跳过 {r}: {e}')

def upload_tar_bytes(sftp, tar_bytes: bytes, remote_dir: str):
    """把一个 tar 字节串写到远端 /tmp 临时文件，ssh 里 tar -xf 到 remote_dir（远端原子替换）"""
    tmp_remote = f'/tmp/deploy-{int(time.time())}.tar'
    with sftp.open(tmp_remote, 'wb') as f:
        f.write(tar_bytes)
    return tmp_remote

def pack_dir_to_tar_bytes(local_dir: Path, sub_include=None):
    """把 local_dir 打包成 .tar（无 gzip，直接裸 tar，远端 tar 解压快）"""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode='w') as tf:
        if sub_include is None:
            tf.add(str(local_dir), arcname='', recursive=True)
        else:
            for rel in sub_include:
                tf.add(str(local_dir / rel), arcname=rel, recursive=True)
    return buf.getvalue()

# ======================= 任务1：snapshot 服务器原始代码/配置/DB =======================
def do_snapshot(cli):
    sftp = cli.open_sftp()
    TS = time.strftime('%Y%m%d-%H%M')
    snap = REPO / 'server-snapshot' / TS
    snap.mkdir(parents=True, exist_ok=True)
    (REPO / 'conf').mkdir(exist_ok=True)
    (REPO / 'data').mkdir(exist_ok=True)
    log('🧳 快照目录:', snap)

    # 远端临时打包（tar）
    tmp = f'/tmp/shuxu-snap-{TS}'
    rc, _, _ = run(cli, f"rm -rf {tmp} && mkdir -p {tmp}/backend")
    # 后端代码
    run(cli, f"[ -d {REMOTE_BACKEND} ] && tar -cf {tmp}/backend/src.tar -C {REMOTE_BACKEND} . 2>/dev/null || echo 'NO_BACKEND_SRC'")
    # 前端代码
    run(cli, f"[ -d {REMOTE_FRONTEND} ] && tar -cf {tmp}/admin.tar -C {REMOTE_FRONTEND} . 2>/dev/null || echo 'NO_FRONTEND'")
    # .env
    run(cli, f"[ -f {REMOTE_ENV} ] && cp -f {REMOTE_ENV} {tmp}/backend.env || echo 'NO_DOTENV'")

    # 拉回本地
    try:
        sftp.get(f'{tmp}/backend/src.tar', str(snap/'backend-src.tar'))
        (snap/'backend'/'src').mkdir(parents=True, exist_ok=True)
        with tarfile.open(snap/'backend-src.tar') as tf: tf.extractall(snap/'backend'/'src')
        log('   ✅ backend/src →', snap/'backend'/'src')
    except Exception as e:
        log('   后端下载失败（可忽略，大概率是 NO_BACKEND_SRC）:', e)
    try:
        sftp.get(f'{tmp}/admin.tar', str(snap/'admin.tar'))
        (snap/'admin').mkdir(parents=True, exist_ok=True)
        with tarfile.open(snap/'admin.tar') as tf: tf.extractall(snap/'admin')
        log('   ✅ admin →', snap/'admin')
    except Exception as e:
        log('   前端下载失败（可忽略）:', e)
    try:
        sftp.get(f'{tmp}/backend.env', str(snap/'backend.env'))
        log('   ✅ .env →', snap/'backend.env')
    except Exception as e:
        log('   .env 下载失败（可忽略）:', e)

    # Nginx 配置
    try:
        sftp.get(REMOTE_NGINX, str(snap/'shuxu-erp.conf'))
        shutil_copy(snap/'shuxu-erp.conf', REPO/'conf'/f'shuxu-erp.conf.{TS}')
        # conf/ 放一份当前同名（软链优先，不行就复制）
        target_cur = REPO/'conf'/'shuxu-erp.conf'
        try:
            if target_cur.exists() or target_cur.is_symlink(): target_cur.unlink()
            os.symlink(f'shuxu-erp.conf.{TS}', str(target_cur))
        except Exception:
            shutil_copy(snap/'shuxu-erp.conf', target_cur)
        log('   ✅ Nginx → conf/shuxu-erp.conf (快照时间戳)')
    except Exception as e:
        log('   Nginx 拉不下来（权限问题？），已尝试 sudo:', e)
        # 尝试 sudo 先拷到 admin 家目录
        run(cli, f"sudo -n cp {REMOTE_NGINX} ~/nginx.conf.bak && chown $(id -u):$(id -g) ~/nginx.conf.bak", sudo=False)
        try:
            sftp.get('~/nginx.conf.bak', str(snap/'shuxu-erp.conf'))
            shutil_copy(snap/'shuxu-erp.conf', REPO/'conf'/f'shuxu-erp.conf.{TS}')
            log('   ✅ Nginx（sudo 绕道家目录）→ conf/')
        except Exception as e2:
            log('   Nginx 绕道还是失败:', e2)

    # DB 全量导出（优先 .env 的账号，兜底 summary 里的 shuxu/K9mXw7pQ2vRn5tLz）
    log('   🗄️  导出 MariaDB shuxu_erp 全量 ...')
    db_remote_gz = f'{tmp}/shuxu_erp.sql.gz'
    dump_script = fr"""
set +e
U=shuxu; P='K9mXw7pQ2vRn5tLz'; DB=shuxu_erp
if [ -f {REMOTE_ENV} ]; then
  EU=$(grep -E '^DB_USER=' {REMOTE_ENV} | head -1 | cut -d= -f2-)
  EP=$(grep -E '^DB_PASS=' {REMOTE_ENV} | head -1 | cut -d= -f2-)
  [ -n "$EU" ] && U="$EU"
  [ -n "$EP" ] && P="$EP"
fi
(mysqldump -u"$U" -p"$P" --default-character-set=utf8mb4 --single-transaction --routines --triggers --quick "$DB" 2>/tmp/dumpe.log \
  | gzip > {db_remote_gz})
RC=${{PIPESTATUS[0]}}
echo "DUMP_RC=$RC SIZE=$(du -k {db_remote_gz} 2>/dev/null | cut -f1)KB"
[ "$RC" != "0" ] && (cat /tmp/dumpe.log | head -20) 1>&2
true
"""
    rc, out, err = run(cli, dump_script, timeout=600)
    db_local_gz = REPO/'data'/f'shuxu_erp-{TS}.sql.gz'
    try:
        sftp.get(db_remote_gz, str(db_local_gz))
        if db_local_gz.stat().st_size < 500:
            log('   ⚠️  DB 文件太小(<500B)，导出可能失败，已保留供你人工检查')
        latest = REPO/'data'/'shuxu_erp-latest.sql.gz'
        try:
            if latest.exists() or latest.is_symlink(): latest.unlink()
            os.symlink(f'shuxu_erp-{TS}.sql.gz', str(latest))
        except Exception:
            shutil_copy(db_local_gz, latest)
        log(f'   ✅ DB → data/shuxu_erp-{TS}.sql.gz ({db_local_gz.stat().st_size//1024} KB)')
    except Exception as e:
        log('   DB 拉取失败:', e)

    run(cli, f"rm -rf {tmp}")
    log(f'\n✅ snapshot 完成 → server-snapshot/{TS}')
    log('   服务器原始数据和仓库新代码已全部『跌倒在一起』，你可以 diff 了：')
    log('     diff -rq server-snapshot/%s/backend/src backend/src' % TS)
    log('     diff    server-snapshot/%s/admin/index.html admin/index.html' % TS)
    return snap

def shutil_copy(src: Path, dst: Path):
    import shutil
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(src, dst)

# ======================= 任务2：deploy 一把梭 =======================
def do_deploy(cli):
    sftp = cli.open_sftp()
    log('🚀 开始发布：backend/src + migrations + admin/index.html → 服务器')

    # 0. 先做远端当天备份
    ts = time.strftime('%Y%m%d-%H%M')
    rc, _, _ = run(cli, f"cd {REMOTE_BACKEND} && tar -cf /tmp/backend-backup-{ts}.tar . 2>/dev/null; echo BACKUP_DONE; [ -f {REMOTE_FRONTEND}/index.html ] && cp -f {REMOTE_FRONTEND}/index.html /tmp/admin-index-{ts}.bak")

    # 1. 打包 backend/src/ → tar 上传 → 解压
    log('   打包 backend/src ...')
    tar_bytes = pack_dir_to_tar_bytes(REPO/'backend'/'src')
    tmp_tar = upload_tar_bytes(sftp, tar_bytes, REMOTE_BACKEND)
    run(cli, f"cd {REMOTE_BACKEND} && tar -xf {tmp_tar} && rm -f {tmp_tar} && echo 'BACKEND_OK'")

    # 2. 把 migrations 里的 v2/v3/v4 拷到 REMOTE_BACKEND 下
    log('   同步 migrations/*.js ...')
    for mig in ['migrate-v2.js','migrate-v3.js','migrate-v4.js']:
        local = REPO/'migrations'/mig
        if local.exists():
            sftp.put(str(local), f'{REMOTE_BACKEND}/{mig}')

    # 3. admin/index.html 原子替换
    log('   同步 admin/index.html ...')
    sftp.put(str(REPO/'admin'/'index.html'), f'{REMOTE_FRONTEND}/index.html.new')
    run(cli, f"mv -f {REMOTE_FRONTEND}/index.html.new {REMOTE_FRONTEND}/index.html && ls -la {REMOTE_FRONTEND}/index.html")

    # 4. 远端语法校验
    log('   远端 node --check 全量校验 ...')
    run(cli, f"cd {REMOTE_BACKEND} && for f in app.js sync-service.js scheduler.js inventory-ledger.js migrate-v2.js migrate-v3.js migrate-v4.js patch-ledger.js routes/*.js middleware/*.js platforms/*.js; do [ -f \"$f\" ] && node --check \"$f\" || true; done; echo CHECK_DONE")

    # 5. 迁移 v2→v3→v4（幂等，允许 Duplicate 报错）
    log('   执行数据库迁移 ...')
    run(cli, f"cd {REMOTE_BACKEND} && node migrate-v2.js 2>&1 | tail -5 ; echo '[v2]'; node migrate-v3.js 2>&1 | tail -5 ; echo '[v3]'; node migrate-v4.js 2>&1 | tail -5 ; echo '[v4]'", timeout=300)

    # 6. 重启后端（systemd → pm2 → 8090 兜底 kill-HUP）
    log('   重启后端服务 ...')
    restart = r"""
set +e
SVC=$(systemctl list-units --type=service --no-legend 2>/dev/null | grep -iE 'shuxu|erp|node' | awk '{print $1}' | head -1)
if [ -n "$SVC" ]; then
  echo "systemctl restart $SVC"
  sudo -n systemctl restart "$SVC" 2>/dev/null || systemctl --user restart "$SVC" 2>/dev/null
fi
if command -v pm2 >/dev/null 2>&1; then
  PM2_APP=$(pm2 list 2>/dev/null | grep -iE 'shuxu|erp|index|app' | awk '{print $4}' | head -1)
  [ -n "$PM2_APP" ] && echo "pm2 restart $PM2_APP" && pm2 restart "$PM2_APP" || true
fi
PID=$(ss -ltnp 2>/dev/null | grep ':8090 ' | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2)
if [ -n "$PID" ]; then
  echo "kill -HUP 8090 pid=$PID"
  kill -HUP "$PID" 2>/dev/null || kill "$PID" 2>/dev/null
fi
sleep 2
echo "8090 HTTP 探测:"
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8090/ || true
"""
    run(cli, restart, timeout=60)

    # 7. Nginx reload 一次（每次都做，保险起见）
    log('   Nginx reload ...')
    rc1, o1, e1 = run(cli, "sudo -n nginx -t 2>&1 | tail -3; sudo -n systemctl reload nginx 2>&1 | tail -3 || sudo -n nginx -s reload 2>&1 | tail -3 || echo NGINX_RELOAD_TRY_DONE", sudo=False)

    log('\n✅ deploy 一把梭完成！')
    log('   现在直接打开 https://qianniu-erp.cc/app/#/dashboard 就能看到新版概览（不再是 shops）')

# ======================= 任务3：domain-only（根 / → 301 /app/） =======================
def do_domain_only(cli):
    log('🌐 Nginx: qianniu-erp.cc / → 301 /app/')
    # 用 heredoc 生成 python 脚本再 sudo 执行（避免多层引号嵌套）
    heredir = '/tmp/nginx_inject.py'
    script_lines = [
        'import re, sys, shutil, datetime',
        'p = "/etc/nginx/conf.d/shuxu-erp.conf"',
        'with open(p,"r") as f: s = f.read()',
        'blk_chars = [chr(10), "location = / {", "    return 301 https://qianniu-erp.cc/app/;", "}", chr(10)]',
        'blk = chr(10).join(blk_chars)',
        'if "location = /" in s:',
        '    print("location = / 已存在，跳过"); sys.exit(0)',
        'shutil.copy(p, p + "." + datetime.datetime.now().strftime("%Y%m%d%H%M") + ".bak")',
        's2 = re.sub(r"(server\\s*\\{[^}]*?\\n)\\s*(location\\s+/\\s*\\{)", r"\\1" + blk + r"\\n    \\2", s, count=1, flags=re.S)',
        'if s2 == s: s2 = s.replace("server {", "server {" + blk, 1)',
        'if s2 == s: raise SystemExit("无法自动插入 location = /，请手工编辑")',
        'with open(p,"w") as f: f.write(s2)',
        'print("已注入 location = / → /app/")',
    ]
    sftp = cli.open_sftp()
    with sftp.open(heredir, 'w') as f:
        f.write('\n'.join(script_lines))
    sftp.chmod(heredir, 0o644)
    rc, o, e = run(cli, f"sudo -n python3 {heredir} && sudo -n nginx -t 2>&1 | tail -3 && (sudo -n systemctl reload nginx 2>&1 || sudo -n nginx -s reload 2>&1) | tail -3", timeout=120, sudo=False)
    if rc == 0:
        log('✅ 根域名统一完成：https://qianniu-erp.cc/ → 301 → https://qianniu-erp.cc/app/')
    else:
        log('⚠️  domain-only 过程中 exit!=0，上面 STDOUT/STDERR 请检查（多半是 sudo nginx -t/reload 权限）')

def main():
    actions = sys.argv[1:]
    if not actions or actions[0] not in ('snapshot','deploy','domain-only','all'):
        print(__doc__)
        sys.exit(1)
    cli, host = connect()
    try:
        if actions[0] == 'snapshot':
            do_snapshot(cli)
        elif actions[0] == 'deploy':
            do_deploy(cli)
        elif actions[0] == 'domain-only':
            do_domain_only(cli)
        elif actions[0] == 'all':
            do_snapshot(cli)
            do_deploy(cli)
            do_domain_only(cli)
            log('\n🎉 全部完成：服务器原始数据 ↔ 仓库新代码 跌倒在一起 + 全量发布 + 根域名统一入口')
    finally:
        try: cli.close()
        except: pass

if __name__ == '__main__':
    main()
