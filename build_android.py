#!/usr/bin/env python3
"""服务器装 Android 构建环境 + 打包 APK"""
import socket, time, paramiko, subprocess, tarfile, os

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

print('='*60)
print('📱 服务器 Android 构建环境 + 打包 APK')
print('='*60)

c = connect()

# Step 1: 装 JDK 17
print('\n📦 Step 1: 装 JDK 17')
o, _ = run(c, 'sudo apt-get update -qq && sudo apt-get install -y -qq openjdk-17-jdk-headless 2>&1 | tail -5')
print(o[:300])
o, _ = run(c, 'java -version 2>&1')
print(f'java: {o[:100]}')

# Step 2: 装 Android SDK command-line tools
print('\n📦 Step 2: 装 Android SDK command-line tools')
o, _ = run(c, """
export ANDROID_HOME=/opt/android-sdk
sudo mkdir -p $ANDROID_HOME && sudo chown $(whoami) $ANDROID_HOME
cd /tmp
wget -q https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip -O cmdline-tools.zip 2>&1
echo "wget exit=$?"
ls -la cmdline-tools.zip 2>/dev/null || echo "zip not found"
""", timeout=120)
print(o[:500])

# 如果 wget 失败，用 curl 替代
if 'wget exit=0' not in o:
    print('wget 失败，换 curl...')
    o2, _ = run(c, """
    export ANDROID_HOME=/opt/android-sdk
    cd /tmp
    curl -sL -o cmdline-tools.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
    echo "curl exit=$?"
    ls -la cmdline-tools.zip 2>/dev/null
    """, timeout=120)
    print(o2[:500])

# Step 3: 解压 Android SDK
print('\n📦 Step 3: 解压 Android SDK')
o, _ = run(c, """
export ANDROID_HOME=/opt/android-sdk
cd /tmp
if [ -f cmdline-tools.zip ]; then
  sudo unzip -q cmdline-tools.zip -d $ANDROID_HOME/cmdline-tools
  sudo mv $ANDROID_HOME/cmdline-tools/cmdline-tools $ANDROID_HOME/cmdline-tools/latest
  ls $ANDROID_HOME/cmdline-tools/latest/bin/
else
  echo "NO ZIP FOUND"
fi
""")
print(o[:500])

# Step 4: 接受 license + 装 build-tools/platforms
print('\n📦 Step 4: 接受 license + 装 Android 组件')
o, _ = run(c, """
export ANDROID_HOME=/opt/android-sdk
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools
yes | sdkmanager --licenses 2>&1 | tail -3
sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0" 2>&1 | tail -10
echo "SDK install done"
ls $ANDROID_HOME/
""", timeout=300)
print(o[:800])

# Step 5: 上传 android 项目 + dist
print('\n📦 Step 5: 上传项目文件')
import subprocess
subprocess.run(['tar', 'czf', '/tmp/thalvior-android.tgz', '-C', '/workspace/wms-app', 'android', 'dist', 'capacitor.config.ts', 'package.json', 'package-lock.json'], check=True)
print('  本地打包完成')
sftp = c.open_sftp()
sftp.put('/tmp/thalvior-android.tgz', '/tmp/thalvior-android.tgz')
sftp.close()
print('  上传服务器完成')

# Step 6: 解压 + 打包
print('\n📦 Step 6: 解压 + 构建 APK')
o, _ = run(c, """
export ANDROID_HOME=/opt/android-sdk
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
export PATH=$PATH:$ANDROID_HOME/platform-tools

cd /home/ubuntu
rm -rf thalvior-app
mkdir thalvior-app && cd thalvior-app
tar xzf /tmp/thalvior-android.tgz
echo "--- files ---"
ls -la

# sync web assets to android
cd android
ANDROID_HOME=$ANDROID_HOME JAVA_HOME=$JAVA_HOME ./gradlew assembleDebug 2>&1 | tail -30
echo "--- gradle exit=$? ---"
find . -name "*.apk" 2>/dev/null
""", timeout=600)
print(o[:1500])

# Step 7: 下载 APK
print('\n📦 Step 7: 下载 APK')
o, _ = run(c, 'find /home/ubuntu/thalvior-app -name "*.apk" 2>/dev/null')
apk_path = o.strip()
if apk_path:
    print(f'APK 路径: {apk_path}')
    sftp = c.open_sftp()
    local_path = '/workspace/thalvior-wms.apk'
    sftp.get(apk_path, local_path)
    sftp.close()
    size = os.path.getsize(local_path)
    print(f'✅ APK 下载完成: {local_path} ({size/1024/1024:.1f} MB)')
else:
    print('❌ APK 没找到')

c.close()
