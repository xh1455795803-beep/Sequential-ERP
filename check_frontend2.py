#!/usr/bin/env python3
"""检查前端部署路径"""
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

def do(label, cmd):
    print('\n=== [' + label + '] ===')
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=30)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    if out: print(out[:500])
    if err: print('ERR:', err[:300])

do('1. nginx 里的 location / 指向哪',
    "sudo grep -A20 'server_name thalvior.icu' /etc/nginx/sites-enabled/meoo | grep -E 'location|root|proxy_pass' | head -20")

do('2. /var/www/ 里有啥',
    "ls -la /var/www/ 2>/dev/null; ls -la /var/www/wms/ 2>/dev/null | head -10")

do('3. /index.html vs /wms/ vs /erp/ 试一下',
    "echo '--- / ---' && sudo cat /var/www/index.html 2>/dev/null | head -5 || echo 'no /var/www/index.html'; "
    "echo '--- /wms/ ---' && sudo ls /var/www/wms/ 2>/dev/null; "
    "echo '--- grep thalvior.icu conf ---' && sudo grep -B5 -A5 'root' /etc/nginx/sites-enabled/meoo | head -30")

# 试几个可能的 ERP 路径
print('\n=== [直接 GET 几个可能的路径] ===')
for path in ['/', '/wms/', '/erp/', '/dashboard/', '/app/']:
    try:
        r = requests.get('https://thalvior.icu' + path, timeout=10, allow_redirects=False)
        print(path, '→ HTTP', r.status_code, 'len=', len(r.text), 'assets?' + str('assets/' in r.text))
    except Exception as e:
        print(path, '→ FAIL', str(e)[:40])

ssh.close()
