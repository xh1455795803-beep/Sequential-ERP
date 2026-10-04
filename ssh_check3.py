#!/usr/bin/env python3
"""SSH probe - deep deployment inspection."""
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
        # Current deployed frontend
        "echo '=== /var/www/meoo ===' && ls -la /var/www/meoo/ | head -20",
        "echo '=== /var/www/meoo/assets ===' && ls /var/www/meoo/assets/ | head -20",
        # Source code
        "echo '=== /opt/thalvior-source ===' && ls -la /opt/thalvior-source/ | head -30",
        "echo '=== source src ===' && ls /opt/thalvior-source/src/ 2>/dev/null | head -20",
        "echo '=== source src/i18n ===' && ls -la /opt/thalvior-source/src/i18n/ 2>/dev/null && ls -la /opt/thalvior-source/src/i18n/pages/ 2>/dev/null || echo 'no i18n pages'",
        "echo '=== source dist ===' && ls /opt/thalvior-source/dist/ 2>/dev/null | head -10",
        "echo '=== source git ===' && cd /opt/thalvior-source && git log --oneline -5 2>/dev/null || echo 'no git'",
        "echo '=== source git status ===' && cd /opt/thalvior-source && git status 2>/dev/null | head -20 || echo 'no git'",
        # Node process on 8788
        "echo '=== Node 8788 ===' && ps aux | grep '8788' | grep -v grep || echo 'not found'",
        "echo '=== Node process ===' && ps aux | grep node | grep -v grep | head -10",
        # Build scripts
        "echo '=== package.json ===' && cat /opt/thalvior-source/package.json 2>/dev/null | head -30",
        # Check if i18n pages exist on server
        "echo '=== i18n locales ===' && cat /opt/thalvior-source/src/i18n/locales/en-US.ts 2>/dev/null | head -10 || echo 'no en-US.ts'",
        "echo '=== i18n pages en ===' && ls /opt/thalvior-source/src/i18n/pages/ 2>/dev/null || echo 'no pages dir'",
        # Check deployed index.html for version
        "echo '=== Deployed index.html ===' && head -20 /var/www/meoo/index.html 2>/dev/null",
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
