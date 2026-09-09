#!/usr/bin/env python3
"""部署妙手风格布局: 备份 -> 上传 MainLayout.tsx -> npm run build -> 校验 dist"""
import sys, socket, os, time, datetime
from urllib.parse import urlparse
import paramiko

HOST = "43.133.232.81"
USER, PWD = "root", "yuan340364"
PROXY_URL = (os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy')
             or os.environ.get('HTTP_PROXY') or os.environ.get('http_proxy'))
REMOTE_LAYOUT = "/opt/thalvior/miaoerp/src/layouts/MainLayout.tsx"
LOCAL_LAYOUT = "/workspace/thalvior-src/layouts/MainLayout.tsx"

def connect():
    p = urlparse(PROXY_URL)
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(20)
    s.connect((p.hostname, p.port or 80))
    s.sendall(f'CONNECT {HOST}:22 HTTP/1.1\r\nHost: {HOST}:22\r\n\r\n'.encode())
    data = b''
    while b'\r\n\r\n' not in data:
        data += s.recv(1)
        if len(data) > 4096: break
    if '200' not in data.split(b'\r\n')[0].decode(errors='ignore'):
        raise RuntimeError('CONNECT 非200')
    cli = paramiko.SSHClient()
    cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    cli.connect(hostname=HOST, port=22, username=USER, password=PWD, sock=s,
                timeout=25, banner_timeout=20, auth_timeout=20,
                allow_agent=False, look_for_keys=False)
    return cli

def run(cli, cmd, timeout=40):
    _, so, se = cli.exec_command(cmd, timeout=timeout)
    return so.read().decode("utf-8","replace"), se.read().decode("utf-8","replace")

try:
    cli = connect()
    sftp = cli.open_sftp()
    print(f"[OK] 连接 {HOST}")

    # 0. 记录旧 dist 时间戳
    t0, _ = run(cli, "stat -c %Y /opt/thalvior/miaoerp/dist/index.html 2>/dev/null || echo none")
    t0 = t0.strip()

    # 1. 备份原始布局
    ts = datetime.datetime.now().strftime("%Y%m%d%H%M%S")
    bak = f"/opt/thalvior/miaoerp/src/layouts/MainLayout.tsx.bak.{ts}"
    out, err = run(cli, f"cp {REMOTE_LAYOUT} {bak} && echo OK || echo FAIL")
    print(f"  备份: {bak} => {out.strip()} {err.strip()}")

    # 2. 上传新布局
    sftp.put(LOCAL_LAYOUT, REMOTE_LAYOUT)
    print("  上传完成:", LOCAL_LAYOUT, "->", REMOTE_LAYOUT)

    # 3. 一致性校验
    local = open(LOCAL_LAYOUT, 'rb').read()
    sftp.get(REMOTE_LAYOUT, "/tmp/_ul.tsx")
    remote = open("/tmp/_ul.tsx", 'rb').read()
    print(f"  字节一致: {local == remote} (local={len(local)} remote={len(remote)})")

    # 4. 构建
    print("  开始 npm run build ...")
    out, err = run(cli, "cd /opt/thalvior/miaoerp && npm run build 2>&1 | tail -25", timeout=400)
    print("  [build stdout]"); print(out.strip() or "(空)")
    if err.strip(): print("  [build stderr]"); print(err.strip())

    # 5. 校验 dist 更新 + Caddy 缓存
    t1, _ = run(cli, "stat -c %Y /opt/thalvior/miaoerp/dist/index.html 2>/dev/null || echo none")
    t1 = t1.strip()
    print(f"  dist/index.html mtime: 旧={t0} 新={t1}  更新={'是' if (t0!=t1 and t1!='none') else '否'}")
    # 刷新已应用的入口文件(SPA: index.html 为 no-cache, 资源带 hash, 无需清 Caddy)
    out, _ = run(cli, "caddy reload --config /etc/caddy/Caddyfile 2>&1 | head -3 || true")
    if out.strip(): print("  caddy reload:", out.strip())
    sftp.close(); cli.close()
    print("[DONE]")
except Exception as e:
    print(f"[ERR] {type(e).__name__}: {e}")