#!/usr/bin/env python3
"""SSH probe - compare server source structure with local."""
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
        # i18n setup
        "echo '=== i18n translations.ts head ===' && head -60 /opt/thalvior-source/src/i18n/translations.ts",
        "echo '=== i18n translations.ts tail ===' && tail -40 /opt/thalvior-source/src/i18n/translations.ts",
        "echo '=== i18n LanguageContext ===' && cat /opt/thalvior-source/src/i18n/LanguageContext.tsx",
        # Routes structure
        "echo '=== routes dir ===' && find /opt/thalvior-source/src/routes -type f -name '*.tsx' 2>/dev/null | sort | head -40",
        "echo '=== routeTree ===' && head -40 /opt/thalvior-source/src/routeTree.gen.ts",
        # Components
        "echo '=== components dir ===' && find /opt/thalvior-source/src/components -maxdepth 2 -type f -name '*.tsx' 2>/dev/null | sort | head -30",
        # Services/API
        "echo '=== services dir ===' && ls /opt/thalvior-source/src/services/ 2>/dev/null",
        # Main entry
        "echo '=== main.tsx ===' && cat /opt/thalvior-source/src/main.tsx",
        # Router
        "echo '=== router.tsx ===' && cat /opt/thalvior-source/src/router.tsx",
        # Check LanguageContext usage in routes
        "echo '=== useLanguage grep ===' && grep -r 'useLanguage\|useTranslation\|LanguageContext' /opt/thalvior-source/src/routes/ 2>/dev/null | head -20",
        # Check how many tsx files use t() or translation
        "echo '=== translation usage count ===' && grep -rl 't(' /opt/thalvior-source/src/routes/ 2>/dev/null | wc -l",
        # Styles
        "echo '=== styles ===' && head -20 /opt/thalvior-source/src/styles.css",
        # Vite config
        "echo '=== vite config ===' && cat /opt/thalvior-source/vite.config.* 2>/dev/null | head -30",
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
