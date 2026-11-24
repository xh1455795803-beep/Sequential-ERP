import socket, time, paramiko, requests

HOST = '43.133.232.81'
USER = 'ubuntu'
PASS = 'yuan340364#'

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

# 1. 先看当前根路径配置
stdin, stdout, stderr = ssh.exec_command(
    "echo '=== 当前 location / ===' && sudo grep -B2 -A10 'location = /' /etc/nginx/sites-enabled/meoo && "
    "echo '=== 当前 location / ===' && sudo grep -B2 -A10 'location / {' /etc/nginx/sites-enabled/meoo | head -20",
    timeout=15)
print(stdout.read().decode())

# 2. 方案：让 / 直接 serve /var/www/wms/index.html 并做 SPA fallback
#    简单做法：location = / return 301 /merchant/login
#    干净做法：改 root /var/www/wms + try_files
#    选简单做法，先让用户访问 / 直接进跨境 ERP 登录
print('=== 改 root 为 301 到 /merchant/login ===')
stdin, stdout, stderr = ssh.exec_command(
    "sudo sed -i '/location = \\/ {/,/}/c\\\n    location = / {\\\n        include /etc/nginx/conf.d/security-headers.conf;\\\n        return 301 /merchant/login;\\\n    }' /etc/nginx/sites-enabled/meoo",
    timeout=15)
print(stdout.read().decode())

# 也把 root / 的 root /var/www/landing 改成 /var/www/wms
stdin, stdout, stderr = ssh.exec_command(
    "sudo sed -i 's|root /var/www/landing;|root /var/www/wms;|g' /etc/nginx/sites-enabled/meoo && "
    "sudo grep 'location = /' -A5 /etc/nginx/sites-enabled/meoo && "
    "sudo grep 'location / {' -A5 /etc/nginx/sites-enabled/meoo | head -10",
    timeout=15)
print(stdout.read().decode())

# 3. nginx -t + reload
print('=== nginx -t ===')
stdin, stdout, stderr = ssh.exec_command("sudo nginx -t", timeout=10)
print(stdout.read().decode())
err = stderr.read().decode()
if err: print('STDERR:', err)

print('=== nginx reload ===')
stdin, stdout, stderr = ssh.exec_command("sudo nginx -s reload 2>&1 || sudo systemctl reload nginx 2>&1", timeout=10)
print(stdout.read().decode() or 'OK')

ssh.close()

# 4. 验证
import time; time.sleep(1)
r = requests.get('https://thalvior.icu/', allow_redirects=False, timeout=15)
print(f'\n=== 验证 ===')
print(f'根路径 /: HTTP {r.status_code}, Location: {r.headers.get("Location", "none")}')

r2 = requests.get('https://thalvior.icu/', allow_redirects=True, timeout=15)
print(f'最终到达: HTTP {r2.status_code}, URL: {r2.url}, len={len(r2.text)}')
