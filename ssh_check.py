#!/usr/bin/env python3
"""SSH via HTTP CONNECT tunnel to check deployment status."""
import paramiko
import socket

PROXY_HOST = '127.0.0.1'
PROXY_PORT = 18080
TARGET_HOST = '43.133.232.81'
TARGET_PORT = 22
USER = 'ubuntu'
PASS = 'Yuan340364#'

def create_tunnel():
    """Create HTTP CONNECT tunnel through proxy."""
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
        "echo '=== System Info ===' && cat /etc/os-release | head -3",
        "echo '=== PM2 Processes ===' && pm2 list 2>/dev/null || echo 'pm2 not found'",
        "echo '=== Frontend Deploy Dir ===' && ls -la /opt/thalvior/miaoerp/ 2>/dev/null || echo 'dir not found'",
        "echo '=== Frontend Build Files ===' && ls -la /opt/thalvior/miaoerp/dist/ 2>/dev/null || echo 'no dist'",
        "echo '=== Frontend Source ===' && ls /opt/thalvior/miaoerp/src/ 2>/dev/null | head -20 || echo 'no src'",
        "echo '=== Caddy Config ===' && cat /etc/caddy/Caddyfile 2>/dev/null || echo 'no caddyfile'",
        "echo '=== Caddy Status ===' && systemctl status caddy 2>/dev/null | head -5 || echo 'no caddy service'",
        "echo '=== Git Log ===' && cd /opt/thalvior/miaoerp 2>/dev/null && git log --oneline -5 2>/dev/null || echo 'no git'",
        "echo '=== Package.json ===' && cat /opt/thalvior/miaoerp/package.json 2>/dev/null | head -20 || echo 'no package.json'",
        "echo '=== Nginx/Caddy running ===' && ps aux | grep -E 'caddy|nginx' | grep -v grep || echo 'none running'",
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
