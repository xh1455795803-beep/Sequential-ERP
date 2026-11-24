import socket, time, paramiko

HOST = '43.133.232.81'; USER='ubuntu'; PASS='yuan340364#'
proxy = socket.socket(); proxy.connect(('127.0.0.1', 18080))
proxy.send(b'CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n')
while b'\r\n\r\n' not in (b''.join([proxy.recv(4096) for _ in range(5)]) if False else b''): pass
time.sleep(0.6)
ssh = paramiko.SSHClient(); ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, sock=proxy)

# 1. 服务器上所有 web 根目录
print('=== 服务器 Web 根目录 ===')
stdin, stdout, stderr = ssh.exec_command("ls -la /var/www/ 2>&1")
print(stdout.read().decode())

# 2. nginx 所有 location → 指向哪里 → 做啥
print('=== nginx thalvior.icu 完整 location 映射 ===')
stdin, stdout, stderr = ssh.exec_command(
    "sudo grep -n -E 'location |root |alias |return ' /etc/nginx/sites-enabled/meoo 2>&1", timeout=15)
print(stdout.read().decode())

# 3. 前端 build 产物在服务器上哪
print('=== /var/www/wms/ ===')
stdin, stdout, stderr = ssh.exec_command("ls -la /var/www/wms/ 2>&1")
print(stdout.read().decode())

# 4. 所有 Docker 容器状态
print('=== Docker 容器 ===')
stdin, stdout, stderr = ssh.exec_command("sudo docker ps --format 'table {{.Names}}\t{{.Status}}' 2>&1")
print(stdout.read().decode())

# 5. 所有 URL 测一遍
import requests
print('=== URL 速测 ===')
urls = [
    'https://thalvior.icu/',
    'https://thalvior.icu/merchant/login',
    'https://thalvior.icu/wms/login',
    'https://thalvior.icu/admin/login',
    'https://thalvior.icu/rest/v1/',
    'https://thalvior.icu/auth/v1/settings',
    'https://thalvior.icu/functions/v1/generate-label-pdf',
]
for u in urls:
    try:
        r = requests.get(u, allow_redirects=False, timeout=10)
        loc = r.headers.get('Location', '-')
        print(f'  {r.status_code:>3}  {u}  →  {loc[:50]}')
    except Exception as e:
        print(f'  ERR  {u} → {e}')

ssh.close()
