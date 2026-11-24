#!/usr/bin/env python3
"""全服务器搜 App 安装包"""
import socket, time, paramiko

HOST, PORT, USER, PASS = '43.133.232.81', 22, 'ubuntu', 'yuan340364#'

def connect():
    sock = socket.socket(); sock.settimeout(15); sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    for _ in range(15):
        try:
            sock.connect(('127.0.0.1', 18080))
            sock.sendall(f'CONNECT {HOST}:{PORT} HTTP/1.1\r\nHost: {HOST}:{PORT}\r\n\r\n'.encode())
            buf = b''
            while b'\r\n\r\n' not in buf:
                d = sock.recv(4096)
                if not d: break
                buf += d
            time.sleep(0.5)
            t = paramiko.Transport(sock); t.start_client(); t.auth_password(USER, PASS)
            c = paramiko.SSHClient(); c._transport = t; c._sftp_live = False
            return c
        except Exception:
            try: sock.close()
            except: pass
            time.sleep(2)
    raise RuntimeError('connect failed')

def run(c, cmd):
    stdin, stdout, stderr = c.exec_command(cmd, timeout=60)
    return stdout.read().decode('utf-8', errors='replace').strip(), stderr.read().decode('utf-8', errors='replace').strip()

c = connect()

print('='*60)
print('🔍 全服务器搜 App 安装包')
print('='*60)

# 1. extension-releases 目录（之前 Session 摘要提过）
print('\n1️⃣ extension-releases 目录:')
o, _ = run(c, 'ls -la /home/ubuntu/extension-releases/ 2>/dev/null; ls -la /opt/thalvior-source/extension-releases/ 2>/dev/null; ls -la /home/ubuntu/extension/ 2>/dev/null')
print(o[:1000])

# 2. 搜常见 App 格式
print('\n2️⃣ find 全服务器 apk/ipa/exe/dmg/deb/app/asar/msi:')
o, _ = run(c, """sudo find /home /opt /var/www /tmp /srv -type f \( -name '*.apk' -o -name '*.ipa' -o -name '*.exe' -o -name '*.dmg' -o -name '*.deb' -o -name '*.asar' -o -name '*.msi' -o -name '*.AppImage' -o -name '*.zip' \) 2>/dev/null | head -50""")
print(o[:2000])

# 3. 搜 extension / app / mobile 目录
print('\n3️⃣ 搜 extension/app/mobile 目录:')
o, _ = run(c, """sudo find /home /opt /var/www /tmp -maxdepth 5 -type d \( -name 'extension*' -o -name '*app*' -o -name '*mobile*' -o -name '*ios*' -o -name '*android*' -o -name '*tauri*' -o -name '*electron*' \) 2>/dev/null | head -30""")
print(o[:1500])

# 4. 搜 package.json 里有 tauri/electron/capacitor
print('\n4️⃣ 搜 package.json (tauri/electron/capacitor):')
o, _ = run(c, """sudo grep -rl 'tauri\\|electron\\|capacitor\\|expo\\|react-native' /home/*/package.json /opt/*/package.json /var/www/*/package.json 2>/dev/null | head -20""")
print(o[:1000])

# 5. /opt/thalvior-source 完整目录树（前几层）
print('\n5️⃣ /opt/thalvior-source 完整目录:')
o, _ = run(c, 'ls -la /opt/thalvior-source/ 2>/dev/null')
print(o[:1500])

# 6. 搜 extension / mobile / app 相关文件
print('\n6️⃣ 搜 extension-releases 内容 (完整列出):')
o, _ = run(c, 'find /opt/thalvior-source/extension-releases/ -type f 2>/dev/null; find /home/ubuntu/ -maxdepth 3 -name "extension*" -type f 2>/dev/null')
print(o[:1000])

c.close()
