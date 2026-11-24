#!/usr/bin/env python3
"""更健壮的分步 Android 打包"""
import socket, time, paramiko, subprocess, os, re, json

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
        except Exception as e:
            try: sock.close()
            except: pass
            time.sleep(2)
    raise RuntimeError('connect failed after 20 attempts')

def run(c, cmd, timeout=300):
    stdin, stdout, stderr = c.exec_command(cmd, timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace').strip(), stderr.read().decode('utf-8', errors='replace').strip()

# ============================================================
# Step 1: 本地打包 tgz
# ============================================================
print('📦 Step 1: 本地打包...')
subprocess.run(['tar', 'czf', '/tmp/thalvior-android.tgz',
    '-C', '/workspace/wms-app', 'android', 'dist', 'capacitor.config.ts'], check=True)
print(f'  ✅ {os.path.getsize("/tmp/thalvior-android.tgz")/1024:.0f} KB')

# ============================================================
# Step 2: 上传（重试 5 次）
# ============================================================
print('\n📦 Step 2: 上传服务器...')
ok = False
for attempt in range(5):
    try:
        c = connect()
        sftp = c.open_sftp()
        sftp.put('/tmp/thalvior-android.tgz', '/tmp/thalvior-android.tgz')
        sftp.close()
        c.close()
        ok = True
        print(f'  ✅ 上传成功 (attempt {attempt+1})')
        break
    except Exception as e:
        print(f'  attempt {attempt+1} fail: {e}')
        time.sleep(3)
if not ok:
    raise RuntimeError('upload failed')

# ============================================================
# Step 3: 解压 + 同步 assets
# ============================================================
print('\n📦 Step 3: 解压 + 同步...')
c = connect()
o, e = run(c, """
cd /home/ubuntu
rm -rf thalvior-app && mkdir thalvior-app
cd thalvior-app
tar xzf /tmp/thalvior-android.tgz
# sync web assets
rm -rf android/app/src/main/assets/public
cp -r dist android/app/src/main/assets/public
ls android/app/src/main/assets/ | head -5
echo "---"
ls android/app/src/main/assets/public/ | head -5
""")
print(o[-500:])
c.close()

# ============================================================
# Step 4: gradle assembleDebug (后台跑，然后轮询)
# ============================================================
print('\n📦 Step 4: gradle assembleDebug (后台，首次要下载)...')
c = connect()
# 清掉之前可能残留的后台进程
run(c, 'pkill -f "gradlew assemble" 2>/dev/null; true')
# 启动后台
run(c, """
export ANDROID_HOME=/opt/android-sdk
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
export PATH=$PATH:$ANDROID_HOME/platform-tools
cd /home/ubuntu/thalvior-app/android
nohup ./gradlew assembleDebug > /tmp/gradle.log 2>&1 &
echo $! > /tmp/gradle.pid
echo "started pid=$(cat /tmp/gradle.pid)"
""")
# 等 5 秒然后后台
time.sleep(5)
o, _ = run(c, 'cat /tmp/gradle.log | tail -20; echo "---"; ps aux | grep gradlew | grep -v grep | head -3')
print(o[-500:])
c.close()

# 轮询等待完成
print('\n⏳ 等待 gradle 完成 (每 30s 查一次)...')
for i in range(60):  # 最多 30 分钟
    time.sleep(30)
    c = connect()
    o, _ = run(c, 'ps aux | grep -E "gradlew|gradle" | grep -v grep | wc -l')
    running = int(o.strip()) if o.strip().isdigit() else 0
    o2, _ = run(c, 'tail -5 /tmp/gradle.log 2>/dev/null')
    done_msg = 'BUILD SUCCESSFUL' in o2 or 'BUILD FAILED' in o2
    c.close()
    
    print(f'  [{(i+1)*30}s] gradle processes={running} | last: {o2[:80]}')
    
    if done_msg or running == 0:
        print('\n🏁 gradle 结束!')
        break

# ============================================================
# Step 5: 下载 APK
# ============================================================
print('\n📦 Step 5: 下载 APK...')
c = connect()
o, _ = run(c, 'find /home/ubuntu/thalvior-app -name "*.apk" 2>/dev/null')
print(f'  找到: {o}')

if o.strip():
    apk_path = o.strip().split('\n')[0]
    sftp = c.open_sftp()
    sftp.get(apk_path, '/workspace/thalvior-wms.apk')
    sftp.close()
    sz = os.path.getsize('/workspace/thalvior-wms.apk')
    print(f'\n🎉 APK 下载完成!')
    print(f'   文件: /workspace/thalvior-wms.apk')
    print(f'   大小: {sz/1024/1024:.1f} MB')
    
    # 打印 gradle log 最后几行
    o2, _ = run(c, 'tail -30 /tmp/gradle.log')
    print(f'\n   Gradle 日志:\n{o2[-500:]}')
else:
    o2, _ = run(c, 'tail -50 /tmp/gradle.log 2>/dev/null')
    print(f'\n❌ APK 未找到! gradle 日志:\n{o2[-1000:]}')

c.close()
