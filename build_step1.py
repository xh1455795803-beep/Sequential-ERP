#!/usr/bin/env python3
"""Step 1: 服务器装 JDK + Android SDK"""
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

def run(c, cmd, timeout=600):
    stdin, stdout, stderr = c.exec_command(cmd, timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace').strip(), stderr.read().decode('utf-8', errors='replace').strip()

c = connect()

print('📦 装 JDK 17...')
o, e = run(c, 'sudo apt-get update -qq 2>&1 | tail -3 && sudo apt-get install -y -qq openjdk-17-jdk-headless 2>&1 | tail -5', 300)
print(f'  JDK: {o[-200:]}')
o, _ = run(c, 'java -version 2>&1 | head -1')
print(f'  ✅ {o}')

print('\n📦 装 Android SDK command-line tools...')
o, _ = run(c, """
export ANDROID_HOME=/opt/android-sdk
sudo mkdir -p $ANDROID_HOME && sudo chown $(whoami):$(whoami) $ANDROID_HOME
cd /tmp
curl -sL -o cmdline-tools.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
ls -la cmdline-tools.zip
unzip -q -o cmdline-tools.zip -d $ANDROID_HOME/cmdline-tools 2>&1
mv $ANDROID_HOME/cmdline-tools/cmdline-tools $ANDROID_HOME/cmdline-tools/latest 2>/dev/null
ls $ANDROID_HOME/cmdline-tools/latest/bin/
""", 180)
print(f'  SDK tools: {o[-300:]}')

print('\n📦 接受 license + 装 Android 组件...')
o, _ = run(c, """
export ANDROID_HOME=/opt/android-sdk
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin
yes | sdkmanager --licenses > /dev/null 2>&1
sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0" 2>&1 | tail -5
ls $ANDROID_HOME/
ls $ANDROID_HOME/platforms/
ls $ANDROID_HOME/build-tools/
""", 300)
print(f'  components: {o[-400:]}')

print('\n✅ Android 环境就绪!')
c.close()
