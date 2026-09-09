#!/usr/bin/env python3
"""SSH 隧道探针 thalvior.icu = 43.133.232.81 root，定位前端部署+服务端解构"""
import sys, socket, os
from urllib.parse import urlparse
try:
    import paramiko
except ImportError:
    sys.exit("[ERR] paramiko not installed")

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
    ("系统", "cat /etc/os-release | head -2; uname -a"),
    ("nginx配置目录", "ls /etc/nginx/conf.d/ 2>/dev/null; ls /etc/nginx/sites-enabled/ 2>/dev/null"),
    ("thalvior nginx配置", "grep -rl thalvior /etc/nginx/ 2>/dev/null"),
    ("根 文件系统顶层", "ls /data /var/www /opt /srv /home 2>/dev/null"),
    ("可能的前端目录", "find / -maxdepth 4 -type d -name 'dist' 2>/dev/null | head; echo '--'; find / -maxdepth 4 -type d \( -iname '*thalvior*' -o -iname '*erp*' -o -iname '*workbench*' \) 2>/dev/null | head"),
    ("node/pm2/docker", "command -v node pm2 docker; node -v 2>/dev/null; soul; sson; echo 'pm2:'; pm2 list 2>/dev/null | head; echo 'docker:'; docker ps 2>/dev/null | head"),
    ("监听端口", "ss -ltnp 2>/dev/null | grep -E ':(80|443|3000|8000|8080|9000|8090|5000)' | head"),
    ("后端进程", "ps aux | grep -v grep | grep -E 'node|nginx|java|python' | awk '{print $2,$11,$12,$NF}' | head"),
    ("磁盘/内存", "df -h | grep -E '/(data|opt|var|$)' | head; free -h | head -2"),
]

try:
    cli = connect()
    print(f"[OK] SSH 隧道连接成功 {HOST} (root)\n")
    for name, cmd in cmds:
        print(f"===== {name} =====")
        _, so, se = cli.exec_command(cmd, timeout=40)
        out = so.read().decode("utf-8","replace").strip()
        err = se.read().decode("utf-8","replace").strip()
        print(out or err or "(无输出)")
    cli.close()
except Exception as e:
    print(f"[ERR] {type(e).__name__}: {e}")