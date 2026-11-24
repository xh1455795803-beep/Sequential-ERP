import socket, time, paramiko, os

proxy = socket.socket()
proxy.connect(('127.0.0.1', 18080))
proxy.send(b'CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n')
resp = b''
while b'\r\n\r\n' not in resp:
    chunk = proxy.recv(4096)
    if not chunk: break
    resp += chunk
time.sleep(0.8)

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('43.133.232.81', username='ubuntu', password='yuan340364#', sock=proxy)

# tar dist locally
local_dist = '/workspace/wms-app/dist'
local_tar = '/tmp/wms-dist-v3.tgz'
os.system(f'cd {local_dist} && tar czf {local_tar} .')
print(f'Local tar: {os.path.getsize(local_tar)} bytes')

# SCP upload
sftp = ssh.open_sftp()
sftp.put(local_tar, '/home/ubuntu/wms-dist-v3.tgz')
sftp.close()
print('Uploaded to server')

# Deploy + verify
cmd = """
echo '=== Deploy ===' && \
sudo rm -rf /var/www/wms/* && \
sudo tar xzf /home/ubuntu/wms-dist-v3.tgz -C /var/www/wms/ && \
sudo chown -R www-data:www-data /var/www/wms && \
ls -la /var/www/wms/ && \
echo '=== Nginx test ===' && \
curl -s -o /dev/null -w 'HTTP %{http_code}\n' http://localhost/ && \
echo '=== Edge Functions health ===' && \
docker ps --filter name=edge-functions --format '{{.Status}}'
"""
stdin, stdout, stderr = ssh.exec_command(cmd)
print(stdout.read().decode())
err = stderr.read().decode()
if err: print('STDERR:', err[:500])

ssh.close()
