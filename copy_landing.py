#!/usr/bin/env python3
"""上传 landing.html → 覆盖 /var/www/landing/index.html"""
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

# SFTP 上传到 /tmp
sftp = ssh.open_sftp()
sftp.put('/workspace/landing.html', '/tmp/landing.html')
sftp.close()
print('✅ uploaded to /tmp/landing.html')

# sudo cp 覆盖
stdin, stdout, stderr = ssh.exec_command(
    "sudo cp /tmp/landing.html /var/www/landing/index.html && "
    "sudo chown www-data:www-data /var/www/landing/index.html && "
    "rm /tmp/landing.html && "
    "ls -la /var/www/landing/index.html",
    timeout=15)
print(stdout.read().decode())

# 验证
r = requests.get('https://thalvior.icu/', timeout=15)
print(f'\n✅ marketing: HTTP {r.status_code}, len={len(r.text)}')
print('   有 portal 玻璃卡:', '.portal' in r.text and 'backdrop-filter' in r.text)

ssh.close()
