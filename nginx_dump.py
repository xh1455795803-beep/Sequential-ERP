#!/usr/bin/env python3
"""修 nginx — /erp/ 和 /wms/ 都指向 /var/www/wms/"""
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

# 完整 nginx conf
stdin, stdout, stderr = ssh.exec_command(
    "sudo cat /etc/nginx/sites-enabled/meoo | grep -n '' | sed -n '190,260p'",
    timeout=15)
print(stdout.read().decode())

# 看看整个文件有几个 location
stdin, stdout, stderr = ssh.exec_command(
    "sudo grep -n 'location ' /etc/nginx/sites-enabled/meoo",
    timeout=15)
print('\n=== 所有 location ===')
print(stdout.read().decode())

ssh.close()
