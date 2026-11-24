#!/usr/bin/env python3
"""nginx 加 /erp/ location + reload"""
import socket, time, paramiko

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

# 备份 + 在 /wms/ location 后面插入 /erp/ 和 /dashboard/
cmd = r'''
sudo cp /etc/nginx/sites-enabled/meoo /etc/nginx/sites-enabled/meoo.bak.$(date +%s)

sudo python3 << 'PYEOF'
path = '/etc/nginx/sites-enabled/meoo'
with open(path) as f: c = f.read()

# 在 /wms { return 301 /wms/; } 这行后面插入
insert_after = "location = /wms { return 301 /wms/; }"

erp_block = """

    location ^~ /erp/ {
        alias /var/www/wms/;
        index index.html;
        try_files $uri $uri/ /erp/index.html;
        include /etc/nginx/conf.d/security-headers.conf;
        add_header Cache-Control "no-store, no-cache, must-revalidate";
    }
    location = /erp { return 301 /erp/; }

    location ^~ /dashboard/ {
        alias /var/www/wms/;
        index index.html;
        try_files $uri $uri/ /dashboard/index.html;
        include /etc/nginx/conf.d/security-headers.conf;
        add_header Cache-Control "no-store, no-cache, must-revalidate";
    }
    location = /dashboard { return 301 /dashboard/; }
"""

if 'location ^~ /erp/' not in c:
    c = c.replace(insert_after, insert_after + erp_block)
    with open(path, 'w') as f: f.write(c)
    print('✅ 已插入 /erp/ 和 /dashboard/ location')
else:
    print('⚠️ 已存在 /erp/ location，跳过')
PYEOF

# 测试 + reload
sudo nginx -t 2>&1 && sudo nginx -s reload && echo '✅ nginx reloaded'

# 验证
curl -s https://thalvior.icu/erp/ | head -30
echo '---'
curl -s https://thalvior.icu/wms/ | head -10
'''

stdin, stdout, stderr = ssh.exec_command(cmd, timeout=30)
print(stdout.read().decode()[:2000])
err = stderr.read().decode()
if err: print('ERR:', err[:300])

ssh.close()
