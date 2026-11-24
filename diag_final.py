import socket, time, paramiko

HOST = '43.133.232.81'; USER='ubuntu'; PASS='yuan340364#'
proxy = socket.socket(); proxy.connect(('127.0.0.1', 18080))
proxy.send(b'CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n')
time.sleep(0.8)
ssh = paramiko.SSHClient(); ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, sock=proxy)

# 1. nginx 完整配置
print('=== nginx/sites-enabled/meoo 完整配置 ===')
stdin, stdout, stderr = ssh.exec_command('sudo cat /etc/nginx/sites-enabled/meoo', timeout=10)
print(stdout.read().decode())

# 2. 看看 ERP dist 是否能直接 serve
print('\n=== curl / (当前 nginx 根路径) ===')
import requests
try:
    r = requests.get('https://thalvior.icu/', timeout=10)
    print(f'Status: {r.status_code}')
    print(f'Content-Type: {r.headers.get("Content-Type")}')
    # 看看引用的 assets
    import re
    refs = re.findall(r'(?:src|href)="(/[^"]*assets/[^"]*)"', r.text)
    print(f'Assets refs: {refs}')
except Exception as e:
    print(f'Err: {e}')

# 3. ERP (meoo) 的 index.html 存在吗？
print('\n=== /var/www/meoo/index.html ===')
stdin, stdout, stderr = ssh.exec_command('ls -la /var/www/meoo/index.html /var/www/meoo/assets/ 2>&1 | head -10', timeout=10)
print(stdout.read().decode())

# 4. /var/www/landing/index.html 存在吗？
print('\n=== /var/www/landing/index.html ===')
stdin, stdout, stderr = ssh.exec_command('ls -la /var/www/landing/index.html 2>&1', timeout=10)
print(stdout.read().decode() or '(不存在)')

# 5. 试试 build ERP
print('\n=== 重新 build ERP (thalvior-source) ===')
stdin, stdout, stderr = ssh.exec_command(
    'cd /opt/thalvior-source && npm run build 2>&1 | tail -25',
    timeout=180)
print(stdout.read().decode()[-800:])

# 6. build 产物在哪个目录？
print('\n=== ERP build 产物 ===')
stdin, stdout, stderr = ssh.exec_command(
    "ls -la /opt/thalvior-source/dist/ 2>&1 | head -10 && echo '---' && wc -c /opt/thalvior-source/dist/assets/*.js 2>&1 | tail -3",
    timeout=10)
print(stdout.read().decode())

ssh.close()
