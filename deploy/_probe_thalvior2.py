#!/usr/bin/env python3
"""深入探测 /opt/thalvior 结构：前端源码 or dist、后端源码、Caddy、部署方式"""
import sys, socket, os
from urllib.parse import urlparse
import paramiko

HOST = "43.133.232.81"
USER, PWD = "root", "yuan340364"
PROXY_URL = (os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy')
             or os.environ.get('HTTP_PROXY') or os.environ.get('http_proxy'))

def connect():
    p = urlparse(PROXY_URL)
    ph, pp = p.hostname, p.port or 80
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(20)
    s.connect((ph, pp))
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

cmds = [
    ("/opt/thalvior 顶层", "ls -la /opt/thalvior/"),
    ("miaoerp 结构", "ls -la /opt/thalvior/miaoerp/ 2>/dev/null; echo '--src?--'; ls /opt/thalvior/miaoerp/src 2>/dev/null | head; echo '--dist--'; ls /opt/thalvior/miaoerp/dist 2>/dev/null | head -30"),
    ("miaoerp package.json", "cat /opt/thalvior/miaoerp/package.json 2>/dev/null | head -50"),
    ("miaoerp-api 结构", "ls -la /opt/thalvior/miaoerp-api/ 2>/dev/null | head; echo '--src--'; ls /opt/thalvior/miaoerp-api/src 2>/dev/null | head"),
    ("Caddyfile", "cat /etc/caddy/Caddyfile 2>/dev/null; echo '---'; cat ~/Caddyfile 2>/dev/null; echo '---all caddy files---'; find / -maxdepth 3 -name 'Caddyfile' 2>/dev/null"),
    ("git 仓库?", "cd /opt/thalvior/miaoerp && git remote -v 2>/dev/null; echo '--'; ls -la /opt/thalvior/miaoerp/.git 2>/dev/null | head -3"),
]

try:
    cli = connect()
    print(f"[OK] {HOST}\n")
    for name, cmd in cmds:
        print(f"===== {name} =====")
        _, so, se = cli.exec_command(cmd, timeout=40)
        out = so.read().decode("utf-8","replace").strip()
        err = se.read().decode("utf-8","replace").strip()
        print(out or err or "(无输出)")
    cli.close()
except Exception as e:
    print(f"[ERR] {type(e).__name__}: {e}")