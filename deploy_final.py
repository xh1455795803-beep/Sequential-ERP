import socket, time, paramiko, tarfile, os, io

HOST = '43.133.232.81'; USER='ubuntu'; PASS='yuan340364#'
proxy = socket.socket(); proxy.connect(('127.0.0.1', 18080))
proxy.send(b'CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n')
buf = b''
while b'\r\n\r\n' not in buf:
    chunk = proxy.recv(4096)
    if not chunk: break
    buf += chunk
time.sleep(0.6)
ssh = paramiko.SSHClient(); ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, sock=proxy)
sftp = ssh.open_sftp()

# 1. tar dist
local_dist = '/workspace/wms-app/dist'
local_tar = '/tmp/wms-dist.tgz'
with tarfile.open(local_tar, 'w:gz') as tar:
    tar.add(local_dist, arcname='wms-dist')
print(f'Local tar: {os.path.getsize(local_tar)/1024:.0f}KB')

# 2. scp
sftp.put(local_tar, '/tmp/wms-dist.tgz')
print('SCP done')

# 3. 解压 + 部署
stdin, stdout, stderr = ssh.exec_command(
    "mkdir -p /home/ubuntu/wms-dist && "
    "tar xzf /tmp/wms-dist.tgz -C /home/ubuntu/ && "
    "sudo rm -rf /var/www/wms/* && "
    "sudo cp -r /home/ubuntu/wms-dist/* /var/www/wms/ && "
    "ls -la /var/www/wms/ | head -5",
    timeout=30)
print(stdout.read().decode())

# 4. 改 nginx 根路径：从 301 → serve SPA
#    把 "location = / { return 301 /merchant/login; }" 改成 SPA
nginx_patch = """
# 根路径 → SPA（React Router 处理所有路径）
location = / {
    include /etc/nginx/conf.d/security-headers.conf;
    root /var/www/wms;
    try_files /index.html =404;
    default_type text/html;
    add_header Cache-Control "no-store, no-cache, must-revalidate";
}
"""

# 先看当前
stdin, stdout, stderr = ssh.exec_command("sudo grep -n 'location = /' /etc/nginx/sites-enabled/meoo | head -5", timeout=10)
print('Before:', stdout.read().decode())

# 用 python 改文件内容
stdin, stdout, stderr = ssh.exec_command(
    "sudo python3 -c \"\n"
    "import re\n"
    "p='/etc/nginx/sites-enabled/meoo'\n"
    "s=open(p).read()\n"
    "# 把 location = / { ... } 整块替换\n"
    "old='''location = / {\\n        include /etc/nginx/conf.d/security-headers.conf;\\n        return 301 /merchant/login;\\n    }'''\n"
    "new='''location = / {\\n        include /etc/nginx/conf.d/security-headers.conf;\\n        root /var/www/wms;\\n        try_files /index.html =404;\\n        default_type text/html;\\n        add_header Cache-Control \\\\\\\"no-store, no-cache, must-revalidate\\\\\\\";\\n    }'''\n"
    "s=s.replace(old,new)\n"
    "open(p,'w').write(s)\n"
    "print('OK')\n"
    "\"",
    timeout=15)
print('Patch:', stdout.read().decode())
err = stderr.read().decode()
if err: print('STDERR:', err[:500])

# 5. nginx -t + reload
print('=== nginx -t ===')
stdin, stdout, stderr = ssh.exec_command("sudo nginx -t 2>&1", timeout=10)
print(stdout.read().decode())

print('=== nginx reload ===')
stdin, stdout, stderr = ssh.exec_command("sudo nginx -s reload 2>&1 || sudo systemctl reload nginx 2>&1", timeout=10)
print(stdout.read().decode() or 'OK')

# 6. 验证
import requests
print('\n=== URL 验证 ===')
urls = [
    'https://thalvior.icu/',
    'https://thalvior.icu/login',
    'https://thalvior.icu/merchant/login',
    'https://thalvior.icu/wms/login',
    'https://thalvior.icu/admin/login',
]
for u in urls:
    try:
        r = requests.get(u, allow_redirects=False, timeout=10)
        loc = r.headers.get('Location', '')
        is_html = 'text/html' in r.headers.get('Content-Type','')
        print(f'  {r.status_code:>3}  {u:45s}  {"HTML" if is_html else ""}  {("→ "+loc) if loc else ""}')
    except Exception as e:
        print(f'  ERR  {u} → {str(e)[:40]}')

sftp.close(); ssh.close()
