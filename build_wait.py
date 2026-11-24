#!/usr/bin/env python3
"""继续等 gradle + 下载 APK"""
import socket, time, paramiko, os, subprocess

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

print('⏳ 继续等 gradle (每 60s)...')
# 先看当前状态
c = connect()
o, _ = run(c, 'tail -20 /tmp/gradle2.log 2>/dev/null; echo "---"; ls -lh /tmp/gradle2.log 2>/dev/null')
print(f'当前状态:\n{o}')
# 看 gradle 是否在下载
o2, _ = run(c, 'du -sh ~/.gradle/caches/ 2>/dev/null; ls ~/.gradle/caches/modules-2/files-2.1/ 2>/dev/null | wc -l')
print(f'\ngradle 缓存: {o2}')
c.close()

# 继续等
for i in range(30):  # 再等 30 分钟
    time.sleep(60)
    c = connect()
    o, _ = run(c, 'ps aux | grep -E "gradlew" | grep -v grep | wc -l')
    running = int(o.strip()) if o.strip().isdigit() else 0
    o2, _ = run(c, 'tail -5 /tmp/gradle2.log 2>/dev/null')
    size_check, _ = run(c, 'du -sh /home/ubuntu/thalvior-app/android/app/build/ 2>/dev/null')
    done = 'BUILD SUCCESSFUL' in o2 or 'BUILD FAILED' in o2
    c.close()
    print(f'  [{i+1}m] gradle={running} | build_dir={size_check.strip()} | {o2[:80].replace(chr(10)," ")}')
    if done or (running == 0 and i > 0):
        print('🏁 完成!')
        break

# 下载
print('\n📦 找 APK...')
c = connect()
o, _ = run(c, 'tail -30 /tmp/gradle2.log 2>/dev/null')
print(f'gradle 尾部:\n{o[-500:]}')
apk_path = None
o3, _ = run(c, 'find /home/ubuntu/thalvior-app -name "*.apk" -exec ls -la {} \\; 2>/dev/null')
print(f'\nfind apk: {o3}')
if o3.strip():
    import re
    m = re.search(r'(/\S+\.apk)', o3)
    if m: apk_path = m.group(1)

if apk_path:
    sftp = c.open_sftp()
    sftp.get(apk_path, '/workspace/thalvior-wms.apk')
    sftp.close()
    sz = os.path.getsize('/workspace/thalvior-wms.apk')
    print(f'\n🎉 APK 下载完成!')
    print(f'   /workspace/thalvior-wms.apk — {sz/1024/1024:.1f} MB')
else:
    print(f'\n❌ APK 未找到')

c.close()
