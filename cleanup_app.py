#!/usr/bin/env python3
"""全清旧 App 文件"""
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
print('🗑️ 全清旧 App 相关文件')
print('='*60)

# 要删的文件列表（全部和旧 WMS App 相关）
DELETE_LIST = """
/home/ubuntu/thalvior-wms-release.apk
/var/www/thalvior/app/thalvior-wms.apk
/var/www/thalvior/app/thalvior-wms-v1.0.1.apk
/var/www/thalvior/app/thalvior-wms-v1.0.2.apk
/var/www/thalvior/app/thalvior-wms-release.apk
/home/ubuntu/extension-releases/thalvior-collect-extension.zip
/home/ubuntu/qoder-work/s2-import/thalvior-source-only.zip
/home/ubuntu/qoder-work/s2-import/thalvior-full/01-frontend/public/downloads/thalvior-collect-extension.zip
/home/ubuntu/塔奥thalvior_Demo系统.zip
/opt/thalvior-source/dist/downloads/thalvior-collect-extension.zip
/opt/thalvior-source/public/downloads/thalvior-collect-extension.zip
/opt/thalvior-source/extension-releases/thalvior-collect-extension.zip
/opt/thalvior-source/extension-releases/version.txt
/var/www/downloads/thalvior-source-only.zip
/var/www/downloads/thalvior-wms-fixed.zip
"""

# 也删除所有备份里的 extension zip
BACKUP_ZIPS = """
/var/www/meoo-dist-shipping/downloads/thalvior-collect-extension.zip
/var/www/shipping/downloads/thalvior-collect-extension.zip
/var/www/meoo/downloads/thalvior-collect-extension.zip
/var/www/preview-next/downloads/thalvior-collect-extension.zip
"""

# 备份目录里的（这些是历史备份，一起清 extension zip）
BACKUP_DIR_ZIPS = "/opt/backups/*/downloads/thalvior-collect-extension.zip /opt/backups/*/downloads/downloads/thalvior-collect-extension.zip"

all_paths = DELETE_LIST.strip().split('\n') + BACKUP_ZIPS.strip().split('\n')

print(f'\n准备删除 {len(all_paths)} 个指定文件 + 备份目录通配:')
for p in all_paths:
    print(f'  {p}')

# 执行删除
run(c, f"""sudo rm -f {' '.join(all_paths)}""")
run(c, f"""sudo rm -f {BACKUP_DIR_ZIPS}""")

# 如果 /var/www/thalvior/app/ 目录空了，也删掉
run(c, """sudo rmdir /var/www/thalvior/app/ 2>/dev/null || echo 'app dir not empty or not exists'""")
run(c, """sudo rmdir /home/ubuntu/extension-releases/ 2>/dev/null || echo 'extension-releases dir not empty'""")

# 验证删除
print('\n验证残留:')
o, _ = run(c, """sudo find /home /opt /var/www -type f \( -name '*.apk' -o -name 'thalvior-collect-extension.zip' -o -name 'thalvior-wms*.zip' -o -name 'thalvior-source*.zip' \) 2>/dev/null""")
if o.strip():
    print('⚠️ 还有残留:')
    print(o)
else:
    print('✅ 全部清干净了！')

c.close()
