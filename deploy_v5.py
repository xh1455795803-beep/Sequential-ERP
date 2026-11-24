import socket, time, paramiko, tarfile, os

def connect():
    for attempt in range(5):
        try:
            proxy = socket.socket()
            proxy.settimeout(5)
            proxy.connect(('127.0.0.1', 18080))
            proxy.send(b'CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n')
            time.sleep(0.8)
            ssh = paramiko.SSHClient()
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            ssh.connect('43.133.232.81', username='ubuntu', password='yuan340364#', sock=proxy, timeout=10)
            return ssh, proxy
        except Exception as e:
            print(f'  Attempt {attempt+1} failed: {e}, retry in 3s...')
            time.sleep(3)
    raise Exception('All retries failed')

ssh, proxy = connect()
sftp = ssh.open_sftp()

local_tar = '/tmp/wms-v5.tgz'
with tarfile.open(local_tar, 'w:gz') as tar:
    tar.add('/workspace/wms-app/dist', arcname='wms-dist')

sftp.put(local_tar, '/tmp/wms-v5.tgz')
stdin, stdout, stderr = ssh.exec_command(
    "sudo rm -rf /var/www/wms/* && "
    "tar xzf /tmp/wms-v5.tgz -C /home/ubuntu/ && "
    "sudo cp -r /home/ubuntu/wms-dist/* /var/www/wms/ && "
    "sudo chown -R www-data:www-data /var/www/wms && "
    "ls -la /var/www/wms/ && "
    "cat /var/www/wms/index.html",
    timeout=20)
print(stdout.read().decode())

sftp.close(); ssh.close(); proxy.close()
