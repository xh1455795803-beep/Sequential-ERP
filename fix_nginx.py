import socket, time, paramiko, requests, re

HOST = '43.133.232.81'; USER='ubuntu'; PASS='yuan340364#'
proxy = socket.socket(); proxy.connect(('127.0.0.1', 18080))
proxy.send(b'CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n')
time.sleep(0.8)
ssh = paramiko.SSHClient(); ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, sock=proxy)

# 1. 看当前 nginx @spa 和 assets location
print('=== 当前 nginx 关键段 ===')
stdin, stdout, stderr = ssh.exec_command(
    "sudo grep -n -A3 '^    root\\|^    location = /\\|location @spa\\|location /assets/' /etc/nginx/sites-enabled/meoo | head -30",
    timeout=10)
print(stdout.read().decode())

# 2. 修改 nginx
#    - root /var/www/wms → root /var/www/meoo
#    - location = / 的 root 也改成 /var/www/meoo
#    - @spa 的 root 也改成 /var/www/meoo
#    - location /assets/ 的 alias 改成 /var/www/meoo/assets/
#    - 保留 /wms/ location 不动（指向 /var/www/wms）

print('\n=== 应用修改 ===')
stdin, stdout, stderr = ssh.exec_command("""
sudo python3 -c "
import re

p = '/etc/nginx/sites-enabled/meoo'
s = open(p).read()

# root /var/www/wms  →  root /var/www/meoo（但只替换 server 块里第一个 root，以及 location = / 和 @spa 里的）
# 先处理 location = / 里的 root
s = re.sub(r'(location = / \\{[^}]*?)root /var/www/wms;', r'\\1root /var/www/meoo;', s, flags=re.DOTALL)
s = re.sub(r'(location = /index\\.html \\{[^}]*?)root /var/www/wms;', r'\\1root /var/www/meoo;', s, flags=re.DOTALL)

# @spa 里的 root
s = re.sub(r'(location @spa \\{[^}]*?)root /var/www/wms;', r'\\1root /var/www/meoo;', s, flags=re.DOTALL)

# server 块的主 root（第一个出现的 root /var/www/wms）
s = s.replace('root /var/www/wms;', 'root /var/www/meoo;', 1)

# location /assets/ alias
s = s.replace('alias /var/www/wms/assets/;', 'alias /var/www/meoo/assets/;')

# location /downloads/ root  
s = s.replace('location /downloads/ {\\n        root /var/www/wms;', 'location /downloads/ {\\n        root /var/www/meoo;')

open(p, 'w').write(s)
print('OK')
"
""", timeout=15)
print(stdout.read().decode())
err = stderr.read().decode()
if err and 'SyntaxWarning' not in err: print('STDERR:', err[:300])

# 3. 验证改动
print('\n=== 验证改动后 ===')
stdin, stdout, stderr = ssh.exec_command(
    "sudo grep -n 'root /var/www\\|alias /var/www' /etc/nginx/sites-enabled/meoo",
    timeout=10)
print(stdout.read().decode())

# 4. nginx -t + reload
print('\n=== nginx -t ===')
stdin, stdout, stderr = ssh.exec_command('sudo nginx -t 2>&1', timeout=10)
print(stdout.read().decode())

print('\n=== nginx reload ===')
stdin, stdout, stderr = ssh.exec_command('sudo nginx -s reload 2>&1', timeout=10)
print(stdout.read().decode() or 'OK')

# 5. curl 验证
import time; time.sleep(1)
print('\n=== curl 验证 ===')
urls = [
    ('ERP 根路径', 'https://thalvior.icu/'),
    ('ERP 登录页', 'https://thalvior.icu/login'),
    ('ERP 注册页', 'https://thalvior.icu/register'),
    ('WMS 路径', 'https://thalvior.icu/wms/'),
]
for name, url in urls:
    try:
        r = requests.get(url, timeout=10, allow_redirects=False)
        refs = re.findall(r'(?:src|href)="(/[^"]*assets/[^"]*)"', r.text)[:1]
        body_start = r.text[:100] if r.status_code == 200 else ''
        print(f'  {name}: HTTP {r.status_code}  {refs[0][-45:] if refs else body_start[:60]}')
    except Exception as e:
        print(f'  {name}: ERR {str(e)[:40]}')

ssh.close()
