#!/usr/bin/env python3
"""SSH 隧道探针：admin 部署目录 + 后端 8090 + 进程 + 磁盘"""
import sys, socket, os
from urllib.parse import urlparse
try:
    import paramiko
except ImportError:
    sys.exit("[ERR] paramiko not installed")

HOST = "120.55.6.75"
USER, PWD = "admin", "yuan340364"
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
    first = data.split(b'\r\n')[0].decode(errors='ignore')
    if '200' not in first:
        raise RuntimeError('CONNECT 非200: ' + first)
    cli = paramiko.SSHClient()
    cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    cli.connect(hostname=HOST, port=22, username=USER, password=PWD, sock=s,
                timeout=25, banner_timeout=20, auth_timeout=20,
                allow_agent=False, look_for_keys=False)
    return cli

cmds = [
    ("admin目录", "ls -la /opt/shuxu-erp/admin/ | head -40"),
    ("admin/assets", "ls /opt/shuxu-erp/admin/assets/ 2>/dev/null | head"),
    ("admin/index.html 头部", "head -c 500 /opt/shuxu-erp/admin/index.html"),
    ("admin/index.html 是否含妙手布局", "for k in ms-home-wrap topnav-search ERP_GROUPS 'id=\"topnav-groups' root.js index-; do c=$(grep -c \"$k\" /opt/shuxu-erp/admin/index.html 2>/dev/null); echo \"$k => $c\"; done"),
    ("8090健康", "curl -s -o /dev/null -w 'root:%{http_code}\\n' http://127.0.0.1:8090/; curl -s -o /dev/null -w 'health:%{http_code}\\n' http://127.0.0.1:8090/api/health"),
    ("node/pm2进程", "ps aux | grep -v grep | grep -E 'node|pm2' | awk '{print $2,$11,$NF}' | head"),
    ("监听端口", "ss -ltnp 2>/dev/null | grep -E ':8090|:3000|:5000|:80' | head"),
    ("磁盘", "df -h /opt | tail -2"),
    ("内存", "free -h | head -3"),
    ("时间/时间差", "date; date --utc"),
]

try:
    cli = connect()
    print(f"[OK] SSH 隧道连接成功 {HOST}\n")
    for name, cmd in cmds:
        print(f"===== {name} =====")
        _, so, se = cli.exec_command(cmd, timeout=30)
        out = so.read().decode("utf-8","replace").strip()
        err = se.read().decode("utf-8","replace").strip()
        print(out or err or "(无输出)")
    cli.close()
except Exception as e:
    print(f"[ERR] {type(e).__name__}: {e}")