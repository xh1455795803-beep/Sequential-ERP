import socket, time, paramiko, requests

HOST = '43.133.232.81'; USER='ubuntu'; PASS='yuan340364#'
proxy = socket.socket(); proxy.connect(('127.0.0.1', 18080))
proxy.send(b'CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n')
time.sleep(0.6)
ssh = paramiko.SSHClient(); ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, sock=proxy)

# 1. 把 @spa 的 root 从 /var/www/meoo 改成 /var/www/wms
print('=== Fixing @spa root ===')
stdin, stdout, stderr = ssh.exec_command(
    "sudo sed -i 's|root /var/www/meoo;|root /var/www/wms;|g' /etc/nginx/sites-enabled/meoo && "
    "sudo grep -A2 '@spa' /etc/nginx/sites-enabled/meoo",
    timeout=15)
print(stdout.read().decode())

# 2. 也确保主 server 的 root 改成 /var/www/wms
print('=== Fixing main server root ===')
stdin, stdout, stderr = ssh.exec_command(
    "sudo sed -i 's|^    root /var/www/meoo;|    root /var/www/wms;|g' /etc/nginx/sites-enabled/meoo && "
    "sudo grep -n 'root /var/www' /etc/nginx/sites-enabled/meoo",
    timeout=15)
print(stdout.read().decode())

# 3. nginx -t + reload
print('=== nginx -t ===')
stdin, stdout, stderr = ssh.exec_command("sudo nginx -t 2>&1", timeout=10)
print(stdout.read().decode())

print('=== nginx reload ===')
stdin, stdout, stderr = ssh.exec_command("sudo nginx -s reload 2>&1", timeout=10)
print(stdout.read().decode() or 'OK')

# 4. 验证
import time; time.sleep(1)
print('\n=== Verification ===')
for u in ['/', '/login', '/merchant/login', '/wms/login']:
    r = requests.get(f'https://thalvior.icu{u}', timeout=10)
    refs = [l for l in r.text.split('\n') if 'assets/' in l]
    js_ref = [l for l in refs if '.js' in l]
    print(f'  {u:20s} → {r.status_code}  JS ref: {js_ref[0][-50:] if js_ref else "none"}')

ssh.close()
