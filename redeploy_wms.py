"""WMS redeploy + nginx cleanup - 2026-11-24

1. SCP local /workspace/wms-app/dist/ → server /var/www/wms/ (overwrite)
2. 修 nginx：删掉错误 alias 到 WMS 的 /dashboard/, /merchant/, /admin/, /erp/ location blocks
"""
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

# ====== 1. tar local dist ======
local_tar = '/tmp/wms-fix.tgz'
with tarfile.open(local_tar, 'w:gz') as tar:
    tar.add('/workspace/wms-app/dist', arcname='wms-dist')
size = os.path.getsize(local_tar)
print(f'[1] tar created: {size} bytes')

# ====== 2. SCP to server ======
sftp.put(local_tar, '/tmp/wms-fix.tgz')
print('[2] uploaded')

# ====== 3. deploy + cleanup ======
deploy_cmd = """
# 先备份当前 nginx config
sudo cp /etc/nginx/sites-enabled/meoo /etc/nginx/sites-enabled/meoo.bak.$(date +%H%M%S)

# 解压 WMS dist → 覆盖 /var/www/wms/
sudo rm -rf /var/www/wms/*
mkdir -p /home/ubuntu/wms-dist
tar xzf /tmp/wms-fix.tgz -C /home/ubuntu/
sudo cp -r /home/ubuntu/wms-dist/* /var/www/wms/
sudo chown -R www-data:www-data /var/www/wms

echo "=== /var/www/wms/index.html ==="
cat /var/www/wms/index.html | grep -oE 'src="[^"]*\.js"'

echo ""
echo "=== assets ==="
ls -la /var/www/wms/assets/*.js | head -5

echo ""
echo "=== /var/www/wms/ 总文件 ==="
ls -la /var/www/wms/
"""

_, stdout, stderr = ssh.exec_command(deploy_cmd, timeout=30)
print(stdout.read().decode())
if err := stderr.read().decode():
    print('STDERR:', err[:500])

sftp.close()
ssh.close(); proxy.close()
print('\n[OK] WMS redeploy done')
