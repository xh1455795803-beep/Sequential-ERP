#!/usr/bin/env python3
"""Step 2: 上传项目 + gradle 打包 APK"""
import socket, time, paramiko, subprocess, os

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

print('📦 本地打包项目...')
subprocess.run(['tar', 'czf', '/tmp/thalvior-android.tgz', '-C', '/workspace/wms-app', 'android', 'dist', 'capacitor.config.ts'], check=True)
size = os.path.getsize('/tmp/thalvior-android.tgz')
print(f'  ✅ tgz = {size/1024:.0f} KB')

print('\n📦 上传服务器...')
c = connect()
sftp = c.open_sftp()
sftp.put('/tmp/thalvior-android.tgz', '/tmp/thalvior-android.tgz')
sftp.close()
print('  ✅ 上传完成')

print('\n📦 解压 + 同步 assets...')
o, _ = run(c, """
cd /home/ubuntu
rm -rf thalvior-app && mkdir thalvior-app
cd thalvior-app
tar xzf /tmp/thalvior-android.tgz
ls -la

# sync web assets into android
cd android
export ANDROID_HOME=/opt/android-sdk
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
export PATH=$PATH:$ANDROID_HOME/platform-tools

# 把 dist 拷进 android app assets
rm -rf app/src/main/assets/public
cp -r ../dist app/src/main/assets/public
""")
print(o[-500:])

print('\n📦 Gradle assembleDebug (首次要下载 gradle + deps，耐心等)...')
o, e = run(c, """
export ANDROID_HOME=/opt/android-sdk
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
export PATH=$PATH:$ANDROID_HOME/platform-tools

cd /home/ubuntu/thalvior-app/android
./gradlew assembleDebug 2>&1
""", timeout=900)  # 15 分钟
print(o[-2000:])
if e:
    print(f'stderr: {e[-500:]}')

print('\n📦 找 APK...')
o, _ = run(c, 'find /home/ubuntu/thalvior-app -name "*.apk" -exec ls -la {} \\;')
print(o)

# 下载 APK
apk_path = None
for line in o.split('\n'):
    if '.apk' in line:
        import re
        m = re.search(r'(\S+\.apk)', line)
        if m: apk_path = m.group(1)
        break

if not apk_path:
    # 更直接找
    o2, _ = run(c, 'find /home/ubuntu/thalvior-app -name "*.apk" 2>/dev/null')
    apk_path = o2.strip()

if apk_path:
    print(f'\n📦 下载 APK: {apk_path}')
    sftp = c.open_sftp()
    local = '/workspace/thalvior-wms.apk'
    sftp.get(apk_path, local)
    sftp.close()
    sz = os.path.getsize(local)
    print(f'\n🎉 APK 下载完成!')
    print(f'   路径: {local}')
    print(f'   大小: {sz/1024/1024:.1f} MB')
else:
    print('\n❌ APK 没找到')

c.close()
