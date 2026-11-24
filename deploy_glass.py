#!/usr/bin/env python3
"""部署前端 dist 到服务器"""
import socket, time, paramiko, tarfile, io, os

HOST = '43.133.232.81'
USER = 'ubuntu'
PASS = 'yuan340364#'
LOCAL_DIST = '/workspace/wms-app/dist'
REMOTE_DIST = '/var/www/wms'

proxy = socket.socket()
proxy.connect(('127.0.0.1', 18080))
proxy.send(b'CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n')
buf = b''
while b'\r\n\r\n' not in buf:
    chunk = proxy.recv(4096)
    if not chunk: break
    buf += chunk
time.sleep(0.6)
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, sock=proxy)

# 打包
tar_path = '/tmp/wms-dist.tgz'
with tarfile.open(tar_path, 'w:gz') as tar:
    for root, dirs, files in os.walk(LOCAL_DIST):
        for f in files:
            full = os.path.join(root, f)
            arcname = os.path.relpath(full, LOCAL_DIST)
            tar.add(full, arcname=arcname)

print('✅ local tar created:', os.path.getsize(tar_path), 'bytes')

# 上传
sftp = ssh.open_sftp()
sftp.put(tar_path, '/tmp/wms-dist.tgz')
sftp.close()
print('✅ uploaded to remote')

# 部署
cmd = (
    f"sudo rm -rf {REMOTE_DIST} && "
    f"sudo mkdir -p {REMOTE_DIST} && "
    f"sudo tar -xzf /tmp/wms-dist.tgz -C {REMOTE_DIST} && "
    f"sudo chown -R www-data:www-data {REMOTE_DIST} && "
    f"rm /tmp/wms-dist.tgz && "
    f"sudo ls -la {REMOTE_DIST} && "
    f"echo '--- HTTP ---' && "
    f"curl -s -o /dev/null -w '%{{http_code}}' http://localhost/erp/ && echo ''"
)
stdin, stdout, stderr = ssh.exec_command(cmd, timeout=30)
out = stdout.read().decode()
err = stderr.read().decode()
print(out[-1000:] if len(out) > 1000 else out)
if err: print('ERR:', err[-300:])

ssh.close()
print('\n✅ 部署完成')
