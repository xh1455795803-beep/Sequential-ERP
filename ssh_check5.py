#!/usr/bin/env python3
"""SSH probe - i18n coverage and deploy process."""
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
        # Count all route files
        "echo '=== All route files ===' && find /opt/thalvior-source/src/routes -name '*.tsx' | wc -l",
        # Routes that DON'T use useLanguage
        "echo '=== Routes NOT using t() ===' && for f in $(find /opt/thalvior-source/src/routes -name '*.tsx' -not -name '__root*'); do grep -q 'useLanguage' \"$f\" || echo \"$f\"; done | head -40",
        # Count routes not using t()
        "echo '=== Count routes NOT using t() ===' && for f in $(find /opt/thalvior-source/src/routes -name '*.tsx' -not -name '__root*'); do grep -q 'useLanguage' \"$f\" || echo \"$f\"; done | wc -l",
        # Sidebar component
        "echo '=== Sidebar ===' && cat /opt/thalvior-source/src/components/sidebar.tsx 2>/dev/null | head -80",
        # Topbar component
        "echo '=== Topbar ===' && cat /opt/thalvior-source/src/components/topbar.tsx 2>/dev/null | head -60",
        # Deploy script
        "echo '=== Deploy scripts ===' && ls /opt/thalvior-source/scripts/ 2>/dev/null",
        "echo '=== Deploy README ===' && cat /opt/thalvior-source/DEPLOY-README.md 2>/dev/null",
        # Check ops dir
        "echo '=== Ops dir ===' && find /opt/thalvior-source/ops -type f 2>/dev/null | head -20",
        # Git log more
        "echo '=== Git log 15 ===' && cd /opt/thalvior-source && git log --oneline -15",
        # Check the deployed JS for language switch
        "echo '=== Deployed JS size ===' && ls -lh /var/www/meoo/assets/",
        # Check translations.ts size and key count
        "echo '=== Translations key count ===' && grep -c '\": {' /opt/thalvior-source/src/i18n/translations.ts",
        # Check what sections exist in translations
        "echo '=== Translation sections ===' && grep '// =====' /opt/thalvior-source/src/i18n/translations.ts",
        # _layout route (main layout)
        "echo '=== _layout.tsx head ===' && head -60 /opt/thalvior-source/src/routes/_layout.tsx 2>/dev/null",
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
