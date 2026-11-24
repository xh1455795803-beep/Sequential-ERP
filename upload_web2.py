#!/usr/bin/env python3
import paramiko, socket, tarfile, io, os

SERVER = '43.133.232.81'; USER = 'ubuntu'; PASS = 'yuan340364#'

def pc():
    s = socket.socket(); s.settimeout(30)
    s.connect(('127.0.0.1', 18080))
    s.sendall(f'CONNECT {SERVER}:22 HTTP/1.1\r\nHost: {SERVER}:22\r\n\r\n'.encode())
    r = b''
    while b'\r\n\r\n' not in r: r += s.recv(4096)
    return s

sock = pc()
t = paramiko.Transport(sock); t.connect(username=USER, password=PASS)
ssh = paramiko.SSHClient(); ssh._transport = t; ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
sf = paramiko.SFTPClient.from_transport(t)

print("打包 dist...")
buf = io.BytesIO()
with tarfile.open(fileobj=buf, mode='w:gz') as tar:
    for root, dirs, files in os.walk('/workspace/wms-app/dist'):
        for f in files:
            lp = os.path.join(root, f)
            tar.add(lp, arcname=os.path.relpath(lp, '/workspace/wms-app/dist'))
buf.seek(0)

print("上传...")
sf.putfo(buf, '/tmp/wms_dist.tar.gz')
for cmd in [
    'sudo rm -rf /var/www/thalvior/wms/*',
    'sudo tar xzf /tmp/wms_dist.tar.gz -C /var/www/thalvior/wms/',
    'sudo chown -R www-data:www-data /var/www/thalvior/wms/',
    'ls /var/www/thalvior/wms/assets/ | head -3',
    'ls /var/www/thalvior/wms/assets/ | wc -l',
]:
    print(f"$ {cmd}")
    stdin, stdout, stderr = ssh.exec_command(cmd)
    o = stdout.read().decode().strip()
    if o: print(o)

sf.close(); t.close()
print("✅ Web 已重新部署")
