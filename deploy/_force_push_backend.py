#!/usr/bin/env python3
"""强推后端 + 原子验证 + 重启 + 8 个 API 立即活测。
只推送 backend/src/ 下我们改过的文件（不是整站 tar），传完 sha256 一致才允许重启。
"""
import os, sys, re, socket, hashlib, time, json
import paramiko

SRC_ROOT = '/workspace/deploy/backend/src'
REMOTE_ROOT = '/opt/shuxu-erp/backend/src'

PROXY = os.environ.get('HTTPS_PROXY') or 'http://127.0.0.1:18080'
m = re.match(r'https?://([^:]+):(\d+)', PROXY); PROXY_HOST, PROXY_PORT = m.group(1), int(m.group(2))
SSH_HOST, SSH_PORT = '120.55.6.75', 22
SSH_USER, SSH_PASS = 'admin', 'yuan340364'

class ProxiedSock(socket.socket):
    def proxied_connect(self, h, p, ph, pp):
        self.connect((ph, pp))
        self.sendall(f'CONNECT {h}:{p} HTTP/1.1\r\nHost: {h}:{p}\r\nProxy-Connection: Keep-Alive\r\n\r\n'.encode())
        buf = b''
        while b'\r\n\r\n' not in buf:
            c = self.recv(4096)
            if not c: raise Exception('代理提前 EOF')
            buf += c
        head = buf.partition(b'\r\n\r\n')[0].decode('utf-8','ignore')
        if ' 200 ' not in head.split('\r\n')[0]: raise Exception('CONNECT 失败:'+head.split('\r\n')[0])

FILES = [
  'app.js','inventory-ledger.js','patch-ledger.js','scheduler.js','sync-service.js',
  'routes/auth.js','routes/oauth.js','routes/shops.js','routes/inventory.js',
  'routes/audit.js','routes/notifications.js',
  'platforms/index.js','platforms/base.js','platforms/stubs.js',
  'platforms/aliexpress.js','platforms/allegro.js','platforms/amazon.js',
  'platforms/coupang.js','platforms/ebay.js','platforms/fruugo.js','platforms/kaufland.js',
  'platforms/lazada.js','platforms/mercadolibre.js','platforms/onbuy.js','platforms/ozon.js',
  'platforms/qoo10.js','platforms/shein.js','platforms/temu.js','platforms/walmart.js',
  'platforms/wildberries.js'
]

def sha256_file(p):
    h = hashlib.sha256()
    with open(p,'rb') as f:
        for chunk in iter(lambda: f.read(1<<16), b''): h.update(chunk)
    return h.hexdigest()

def main():
    s = ProxiedSock(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(25); s.proxied_connect(SSH_HOST, SSH_PORT, PROXY_HOST, PROXY_PORT)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, port=SSH_PORT, username=SSH_USER, password=SSH_PASS, sock=s, timeout=25, allow_agent=False, look_for_keys=False)
    sftp = ssh.open_sftp()

    # 0. 远端语法预检：看当前服务器上 oauth.js 是否就是 238 行截断版
    def run(cmd, timeout=30):
        _i, o, e = ssh.exec_command(cmd, timeout=timeout, get_pty=True)
        return o.read().decode('utf-8','replace'), e.read().decode('utf-8','replace')
    o, e = run("wc -l /opt/shuxu-erp/backend/src/routes/oauth.js && tail -n 5 /opt/shuxu-erp/backend/src/routes/oauth.js | od -c | tail -n 5")
    print('=== 当前服务器 oauth.js 现状 ===\n'+o); print(e)

    # 1. 先本地对要推送的文件做 node --check 全通过
    print('=== 本地语法校验 ===')
    import subprocess as sp
    for rel in FILES:
        p = os.path.join(SRC_ROOT, rel)
        r = sp.run(['node','--check', p], capture_output=True, text=True)
        status = 'OK' if r.returncode==0 else 'FAIL'
        print(f'[{status}] {rel}')
        if r.returncode != 0:
            print(r.stdout); print(r.stderr); sys.exit(2)

    # 2. 逐个 SFTP 上传，传完立刻对 sha256
    print('\n=== SFTP 精确推送 + sha256 核对 ===')
    for rel in FILES:
        local = os.path.join(SRC_ROOT, rel)
        remote = f'{REMOTE_ROOT}/{rel}'
        local_sum = sha256_file(local)
        # 保证目录存在
        sftp_mkdirs(sftp, os.path.dirname(remote))
        # 直接覆盖写目标文件（不依赖 SFTP rename 覆盖能力，避免 Permission/Failure）
        sftp.put(local, remote)
        # 远端再 sha256
        o2, _ = run(f'sha256sum {remote} | awk "{{print \\$1}}"')
        remote_sum = o2.strip().split()[0]
        mark = '✅' if local_sum == remote_sum else '❌ MISMATCH'
        print(f'{mark} {rel}  local={local_sum[:10]}  remote={remote_sum[:10]}')
        if local_sum != remote_sum:
            print(f'  FAIL 停下不重启'); sys.exit(3)

    # 3. 后端上再做一次远程 node --check 全量，确认没文件截断
    print('\n=== 远端 node --check 全量 ===')
    o3, e3 = run("""cd /opt/shuxu-erp/backend && bad=0; find src -name '*.js' -type f | sort | while read f; do /opt/node20/bin/node --check "$f" 2>&1 | head -n 5; r=$?; [ $r -ne 0 ] && echo "[REMOTE_FAIL] $f rc=$r" && bad=1; done; echo "BAD=$bad" """)
    print(o3); print(e3)

    # 4. 精确重启 shuxu-erp.service，不是 kill -9，避免误杀
    print('\n=== systemctl restart shuxu-erp ===')
    o4, e4 = run('sudo -n systemctl restart shuxu-erp.service 2>&1 || systemctl restart shuxu-erp.service 2>&1')
    print(o4); print(e4); time.sleep(4)
    o4b, e4b = run('systemctl status shuxu-erp.service --no-pager -l -n 20 2>&1; echo "--- journalctl new 50 ---"; journalctl -u shuxu-erp -n 50 --no-pager --since "5 minutes ago" 2>&1 | tail -n 60')
    print(o4b); print(e4b)

    # 5. 立即活测 8 个 API（走 127.0.0.1:8090，绕开 Nginx 更快定位）
    probes = [
      '/api/auth/me',        # 无 token → 401，不是 404
      '/api/auth/login',     # OPTIONS 或 GET → 405/404 都行，先看是不是 404
      '/api/v1/shops',       # 401 → 路由存在
      '/api/v1/platforms',
      '/api/v1/inventory/transactions?limit=5',
      '/api/v1/audit/logs?limit=5',
      '/api/oauth/status',
      '/api/v1/notifications?limit=5',
    ]
    print('\n=== 127.0.0.1:8090 活测 8 个 API ===')
    all_ok = True
    for p in probes:
        o5, e5 = run(f"curl -sS -o /tmp/_p -w 'HTTP:%{{http_code}}\\nSIZE:%{{size_download}}\\n' --max-time 5 http://127.0.0.1:8090{p} ; echo '-- BODY --'; head -c 300 /tmp/_p; echo")
        print(f'--- {p} ---')
        print(o5.strip()[:1200])
        if 'HTTP:404' in o5: all_ok = False

    sftp.close(); ssh.close()
    print('\n====== FINAL:', 'OK ✅ 路由都挂上了' if all_ok else 'FAIL ❌ 还有 404')

def sftp_mkdirs(sftp, remote_dir):
    # 远端 mkdir -p 等价实现
    parts = []
    cur = remote_dir
    while True:
        try:
            sftp.stat(cur); break
        except FileNotFoundError:
            parts.append(cur); cur, _ = os.path.split(cur)
            if _ == '': break
    for d in reversed(parts):
        try: sftp.mkdir(d)
        except: pass

if __name__ == '__main__':
    main()
