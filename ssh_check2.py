#!/usr/bin/env python3
"""SSH probe - find actual deployment paths."""
import paramiko, socket

PROXY_HOST = '127.0.0.1'
PROXY_PORT = 18080
TARGET_HOST = '43.133.232.81'
TARGET_PORT = 22
USER = 'ubuntu'
PASS = 'Yuan340364#'

def create_tunnel():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(15)
    s.connect((PROXY_HOST, PROXY_PORT))
    connect_str = f"CONNECT {TARGET_HOST}:{TARGET_PORT} HTTP/1.1\r\nHost: {TARGET_HOST}:{TARGET_PORT}\r\n\r\n"
    s.sendall(connect_str.encode())
    resp = b""
    while b"\r\n\r\n" not in resp:
        resp += s.recv(4096)
    if b"200" not in resp.split(b"\r\n")[0]:
        raise Exception(f"Tunnel failed: {resp}")
    return s

def run_commands():
    sock = create_tunnel()
    transport = paramiko.Transport(sock)
    transport.connect(username=USER, password=PASS)

    commands = [
        # Find nginx config
        "echo '=== Nginx Sites ===' && ls /etc/nginx/sites-enabled/ 2>/dev/null && cat /etc/nginx/sites-enabled/* 2>/dev/null | head -80",
        # Find web root
        "echo '=== Nginx Root ===' && grep -r 'root ' /etc/nginx/ 2>/dev/null | head -20",
        # Find frontend files
        "echo '=== Find Frontend ===' && find / -maxdepth 4 -name 'package.json' -path '*/thalvior/*' 2>/dev/null | head -10",
        "echo '=== Find dist ===' && find / -maxdepth 5 -type d -name 'dist' 2>/dev/null | head -10",
        "echo '=== Find miaoerp ===' && find / -maxdepth 4 -type d -name '*miao*' 2>/dev/null | head -10",
        # Check for node/pm2/npx
        "echo '=== Node/PM2 ===' && which node 2>/dev/null && node -v 2>/dev/null && which pm2 2>/dev/null && pm2 list 2>/dev/null || echo 'no pm2'",
        "echo '=== NVM ===' && source ~/.nvm/nvm.sh 2>/dev/null && which node && node -v && which pm2 2>/dev/null && pm2 list 2>/dev/null || echo 'no nvm pm2'",
        # Check home dir
        "echo '=== Home ===' && ls -la ~/ && echo '---' && ls -la /opt/ 2>/dev/null | head -20",
        # Docker?
        "echo '=== Docker ===' && docker ps 2>/dev/null || echo 'no docker'",
        # Check ports
        "echo '=== Listening Ports ===' && ss -tlnp 2>/dev/null | head -20",
    ]

    for cmd in commands:
        chan = transport.open_session()
        chan.exec_command(cmd)
        output = b""
        while True:
            data = chan.recv(4096)
            if not data:
                break
            output += data
        print(output.decode('utf-8', errors='replace'))
        print()

    transport.close()
    sock.close()

if __name__ == '__main__':
    run_commands()
