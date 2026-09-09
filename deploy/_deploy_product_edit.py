#!/usr/bin/env python3
"""部署商品编辑大页改造: 备份 -> 上传 ProductEdit/router/ProductList -> npm run build -> 校验 dist"""
import sys, socket, os, datetime
from urllib.parse import urlparse
import paramiko

HOST = "43.133.232.81"
USER, PWD = "root", "yuan340364"
PROXY_URL = (os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy')
             or os.environ.get('HTTP_PROXY') or os.environ.get('http_proxy'))

FILES = [
    ("/workspace/thalvior-src/pages/ProductEdit.tsx", "/opt/thalvior/miaoerp/src/pages/ProductEdit.tsx"),
    ("/workspace/thalvior-src/router/index.tsx", "/opt/thalvior/miaoerp/src/router/index.tsx"),
    ("/workspace/thalvior-src/pages/ProductList.tsx", "/opt/thalvior/miaoerp/src/pages/ProductList.tsx"),
]

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

    t0, _ = run(cli, "stat -c %Y /opt/thalvior/miaoerp/dist/index.html 2>/dev/null || echo none")
    t0 = t0.strip()
    ts = datetime.datetime.now().strftime("%Y%m%d%H%M%S")

    for local, remote in FILES:
        out, _ = run(cli, f"cp {remote} {remote}.bak.{ts} && echo OK || echo FAIL")
        print(f"  备份 {remote}: {out.strip()}")
        sftp.put(local, remote)
        l = open(local, 'rb').read()
        sftp.get(remote, "/tmp/_chk.bin")
        r = open("/tmp/_chk.bin", 'rb').read()
        print(f"  上传 {os.path.basename(local)} 一致={l == r} ({len(l)}b)")

    print("  开始 npm run build ...")
    out, err = run(cli, "cd /opt/thalvior/miaoerp && npm run build 2>&1 | tail -40", timeout=500)
    print("  [build stdout]"); print(out.strip() or "(空)")
    if err.strip(): print("  [build stderr]"); print(err.strip())

    t1, _ = run(cli, "stat -c %Y /opt/thalvior/miaoerp/dist/index.html 2>/dev/null || echo none")
    t1 = t1.strip()
    print(f"  dist/index.html mtime: 旧={t0} 新={t1}  更新={'是' if (t0 != t1 and t1 != 'none') else '否'}")
    out, _ = run(cli, "caddy reload --config /etc/caddy/Caddyfile 2>&1 | head -3 || true")
    if out.strip(): print("  caddy reload:", out.strip())
    sftp.close(); cli.close()
    print("[DONE]")
except Exception as e:
    print(f"[ERR] {type(e).__name__}: {e}")