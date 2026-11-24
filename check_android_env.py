#!/usr/bin/env python3
"""检查服务器是否有 Android 构建环境"""
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
    stdin, stdout, stderr = c.exec_command(cmd, timeout=30)
    return stdout.read().decode('utf-8', errors='replace').strip(), stderr.read().decode('utf-8', errors='replace').strip()

c = connect()

print('=== 服务器 Android 构建环境检查 ===')
for tool in ['java', 'javac', 'gradle', 'android', 'sdkmanager', 'node', 'npm', 'npx']:
    o, _ = run(c, f'which {tool} 2>/dev/null && {tool} --version 2>/dev/null | head -3 || echo "❌ {tool} not found"')
    print(f'  {tool}: {o[:150]}')

print('\n=== ANDROID_HOME / JAVA_HOME ===')
o, _ = run(c, 'echo "ANDROID_HOME=$ANDROID_HOME"; echo "JAVA_HOME=$JAVA_HOME"; ls /opt/android-sdk 2>/dev/null; ls /usr/lib/jvm/ 2>/dev/null; ls ~/Android 2>/dev/null; ls /opt/android* 2>/dev/null')
print(o[:500])

print('\n=== 之前 APK 是怎么构建的? ===')
o, _ = run(c, 'ls -la /home/ubuntu/ | head -20; ls /opt/thalvior-source/android 2>/dev/null || echo "no android dir in source"')
print(o[:500])

c.close()
