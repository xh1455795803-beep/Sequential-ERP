#!/usr/bin/env python3
"""部署 WMS Web 到 **正确的** Nginx 目录 /var/www/wms/"""
import paramiko, socket, tarfile, io, os

SERVER = '43.133.232.81'; USER = 'ubuntu'; PASS = 'yuan340364#'

def pc():
    s = socket.socket(); s.settimeout(15); s.connect(('127.0.0.1', 18080))
    s.sendall(f'CONNECT {SERVER}:22 HTTP/1.1\r\nHost: {SERVER}:22\r\n\r\n'.encode())
    r = b''
    while b'\r\n\r\n' not in r: r += s.recv(4096)
    return s

sock = pc(); t = paramiko.Transport(sock); t.connect(username=USER, password=PASS)
ssh = paramiko.SSHClient(); ssh._transport = t; ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
sf = paramiko.SFTPClient.from_transport(t)

# 打 tar
buf = io.BytesIO()
with tarfile.open(fileobj=buf, mode='w:gz') as tar:
    for root, dirs, files in os.walk('/workspace/wms-app/dist'):
        for f in files:
            lp = os.path.join(root, f)
            tar.add(lp, arcname=os.path.relpath(lp, '/workspace/wms-app/dist'))
buf.seek(0)

print("上传 /tmp/wms_fix.tar.gz ...")
sf.putfo(buf, '/tmp/wms_fix.tar.gz')

# 部署到正确目录
for cmd in [
    'ls -la /var/www/wms/',    # 看看目录状态
    'sudo mkdir -p /var/www/wms',
    'sudo rm -rf /var/www/wms/*',
    'sudo tar xzf /tmp/wms_fix.tar.gz -C /var/www/wms/',
    'sudo chown -R www-data:www-data /var/www/wms/',
    'ls -la /var/www/wms/',
    'ls /var/www/wms/assets/',
]:
    print(f"\n$ {cmd}")
    stdin, stdout, stderr = ssh.exec_command(cmd)
    print(stdout.read().decode())
    err = stderr.read().decode()
    if err: print("ERR:", err)

sf.close(); t.close()
print("\n=== 部署完成！验证 https://thalvior.fun/wms/ ===")
