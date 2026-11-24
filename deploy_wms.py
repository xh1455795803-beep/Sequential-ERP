import socket, time, paramiko, tarfile, os

HOST = '43.133.232.81'; USER='ubuntu'; PASS='yuan340364#'
proxy = socket.socket(); proxy.connect(('127.0.0.1', 18080))
proxy.send(b'CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n')
time.sleep(0.6)
ssh = paramiko.SSHClient(); ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, sock=proxy)
sftp = ssh.open_sftp()

# 1. 确认 WMS index.html 里的引用路径
with open('/workspace/wms-app/dist/index.html', 'r') as f:
    html = f.read()
print('WMS index.html refs:')
import re
for m in re.findall(r'(?:src|href)="([^"]+)"', html):
    print(f'  {m}')

# 2. tar
local_tar = '/tmp/wms-v4.tgz'
with tarfile.open(local_tar, 'w:gz') as tar:
    tar.add('/workspace/wms-app/dist', arcname='wms-dist')
print(f'\nTar size: {os.path.getsize(local_tar)/1024:.0f}KB')

# 3. scp + 部署
sftp.put(local_tar, '/tmp/wms-v4.tgz')
stdin, stdout, stderr = ssh.exec_command(
    "sudo rm -rf /var/www/wms/* && "
    "tar xzf /tmp/wms-v4.tgz -C /home/ubuntu/ && "
    "sudo cp -r /home/ubuntu/wms-dist/* /var/www/wms/ && "
    "sudo chown -R www-data:www-data /var/www/wms && "
    "ls -la /var/www/wms/ && cat /var/www/wms/index.html",
    timeout=20)
print('\n' + stdout.read().decode())

sftp.close(); ssh.close()
