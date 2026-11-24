#!/usr/bin/env python3
"""修复版 Android 打包 — 清旧缓存 + 重构建"""
import socket, time, paramiko, subprocess, os, re

HOST, PORT, USER, PASS = '43.133.232.81', 22, 'ubuntu', 'yuan340364#'

def connect():
    sock = socket.socket(); sock.settimeout(20); sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    for attempt in range(20):
        try:
            sock.connect(('127.0.0.1', 18080))
            sock.sendall(f'CONNECT {HOST}:{PORT} HTTP/1.1\r\nHost: {HOST}:{PORT}\r\n\r\n'.encode())
            buf = b''
            while b'\r\n\r\n' not in buf:
                d = sock.recv(4096)
                if not d: break
                buf += d
            time.sleep(1)
            t = paramiko.Transport(sock); t.start_client(); t.auth_password(USER, PASS)
            c = paramiko.SSHClient(); c._transport = t; c._sftp_live = False
            return c
        except Exception:
            try: sock.close()
            except: pass
            time.sleep(2)
    raise RuntimeError('connect failed')

def run(c, cmd, timeout=300):
    stdin, stdout, stderr = c.exec_command(cmd, timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace').strip(), stderr.read().decode('utf-8', errors='replace').strip()

print('📦 上传修复后的项目...')
subprocess.run(['tar', 'czf', '/tmp/thalvior-android.tgz', '-C', '/workspace/wms-app', 
               'android', 'dist', 'capacitor.config.ts'], check=True)

for attempt in range(5):
    try:
        c = connect()
        sftp = c.open_sftp()
        sftp.put('/tmp/thalvior-android.tgz', '/tmp/thalvior-android.tgz')
        sftp.close()
        c.close()
        print(f'  ✅ 上传成功 (attempt {attempt+1})')
        break
    except Exception as e:
        print(f'  attempt {attempt+1} fail: {e}')
        time.sleep(3)

c = connect()
print('\n📦 清旧缓存 + 解压 + 构建...')
o, _ = run(c, """
export ANDROID_HOME=/opt/android-sdk
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
export PATH=$PATH:$ANDROID_HOME/platform-tools

# 清旧 gradle 缓存里的 capacitor 项目缓存
rm -rf /home/ubuntu/thalvior-app
rm -rf ~/.gradle/caches/build-cache-* 2>/dev/null

cd /home/ubuntu && mkdir thalvior-app && cd thalvior-app
tar xzf /tmp/thalvior-android.tgz

# sync web assets
rm -rf android/app/src/main/assets/public
cp -r dist android/app/src/main/assets/public

echo "--- 构建环境 ---"
java -version 2>&1 | head -1
ls $ANDROID_HOME/platforms/
ls $ANDROID_HOME/build-tools/

# kill 之前可能残留的 gradle
pkill -f gradlew 2>/dev/null; sleep 1

# assembleDebug
cd android
./gradlew clean 2>&1 | tail -3
nohup ./gradlew assembleDebug --no-build-cache > /tmp/gradle2.log 2>&1 &
echo "started pid=$(echo $!)"
""")
print(o[-500:])
c.close()

print('\n⏳ 轮询等待 (每 30s)...')
for i in range(60):
    time.sleep(30)
    c = connect()
    o, _ = run(c, 'ps aux | grep -E "gradlew|gradle-daemon" | grep -v grep | wc -l')
    running = int(o.strip()) if o.strip().isdigit() else 0
    o2, _ = run(c, 'tail -8 /tmp/gradle2.log 2>/dev/null')
    done = 'BUILD SUCCESSFUL' in o2 or 'BUILD FAILED' in o2 or 'ERROR' in o2[-100:]
    c.close()
    print(f'  [{(i+1)*30}s] gradle={running} | {o2[:70].replace(chr(10)," ")}')
    if done or running == 0:
        print('🏁')
        break

print('\n📦 下载 APK...')
c = connect()
o2, _ = run(c, 'tail -40 /tmp/gradle2.log')
print(f'  gradle log tail:\n{o2[-600:]}')

apk_path = None
o3, _ = run(c, 'find /home/ubuntu/thalvior-app -name "*.apk" 2>/dev/null')
if o3.strip():
    apk_path = o3.strip().split('\n')[0]

if apk_path:
    sftp = c.open_sftp()
    sftp.get(apk_path, '/workspace/thalvior-wms.apk')
    sftp.close()
    sz = os.path.getsize('/workspace/thalvior-wms.apk')
    print(f'\n🎉 APK 下载完成!')
    print(f'   文件: /workspace/thalvior-wms.apk')
    print(f'   大小: {sz/1024/1024:.1f} MB')
else:
    print(f'\n❌ APK 未找到')

c.close()
