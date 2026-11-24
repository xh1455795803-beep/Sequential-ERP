#!/usr/bin/env python3
"""修 nginx 备份文件位置 + reload"""
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

cmd = """
# 把备份文件移出 sites-enabled 到 /root/
sudo mv /etc/nginx/sites-enabled/meoo.bak.* /root/ 2>/dev/null; sudo rm -f /etc/nginx/sites-enabled/meoo.bak.*
# 验证 /erp/ location 是否在 meoo 里
grep -c 'location ^~ /erp' /etc/nginx/sites-enabled/meoo
# nginx test
sudo nginx -t 2>&1
# reload
sudo nginx -s reload 2>&1 && echo '✅ reload OK'
# 测试
echo '--- /erp/ 直接 curl ---'
curl -s https://thalvior.icu/erp/ | grep -E 'glass|backdrop|blob' | head -3
echo '--- 没有 glass 类？看 dist 里的 css ---'
sudo cat /var/www/wms/assets/index-*.css | head -5
"""
stdin, stdout, stderr = ssh.exec_command(cmd, timeout=30)
print(stdout.read().decode()[:2000])
err = stderr.read().decode()
if err: print('ERR:', err[:300])

ssh.close()
