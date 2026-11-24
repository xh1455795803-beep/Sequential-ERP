#!/usr/bin/env python3
"""修 marketing landing 根路径"""
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

# 1. 找根路径到底指向哪
stdin, stdout, stderr = ssh.exec_command(
    "sudo grep -A2 'location = / {' /etc/nginx/sites-enabled/meoo | head -10; "
    "sudo grep -A2 'location / {' /etc/nginx/sites-enabled/meoo | head -10; "
    "sudo grep 'root ' /etc/nginx/sites-enabled/meoo",
    timeout=15)
print('=== nginx 根路径 ===')
print(stdout.read().decode())

# 2. 看 /var/www 下的 index.html
stdin, stdout, stderr = ssh.exec_command(
    "ls -la /var/www/index.html 2>/dev/null; ls -la /var/www/meoo/ 2>/dev/null; "
    "sudo grep 'root ' /etc/nginx/sites-enabled/meoo | head -3",
    timeout=15)
print('=== /var/www 根 ===')
print(stdout.read().decode())

ssh.close()
