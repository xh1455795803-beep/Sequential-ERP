#!/usr/bin/env python3
"""检查 nginx /erp/ 路径配置 + 修复"""
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

# 找 nginx 里所有 thalvior.icu 的 location
do('1. nginx conf 里 thalvior.icu 所有 location',
    "sudo grep -n -A5 'thalvior.icu\\|/erp\\|/wms' /etc/nginx/sites-enabled/meoo | head -60")

# 测试 /erp/ 能不能直接读到 index.html
do('2. 本地 nginx 直接 GET /erp/',
    "curl -s http://localhost/erp/ | head -5")

# 用 HTTPS 测试
try:
    r = requests.get('https://thalvior.icu/erp/', timeout=15, allow_redirects=True)
    print('\n=== [3. HTTPS /erp/ 测试] ===')
    print('HTTP', r.status_code, 'len=', len(r.text))
    print('has glassmorphism class:', 'glass' in r.text or 'blob' in r.text or 'backdrop-blur' in r.text)
    print('has float-anim:', 'float' in r.text.lower())
except Exception as e:
    print('\n=== [3. FAIL] ===', str(e)[:80])

ssh.close()
