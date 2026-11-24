#!/usr/bin/env python3
"""简单版：移走备份 + nginx reload"""
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

# Step 1: 移走备份
stdin, stdout, stderr = ssh.exec_command(
    "sudo bash -c 'mv /etc/nginx/sites-enabled/meoo.bak.* /root/ 2>/dev/null; rm -f /etc/nginx/sites-enabled/meoo.bak.*; echo done'",
    timeout=10)
print('移备份:', stdout.read().decode().strip())

# Step 2: nginx -t
stdin, stdout, stderr = ssh.exec_command("sudo nginx -t", timeout=10)
print('nginx -t:', stdout.read().decode().strip(), stderr.read().decode().strip())

# Step 3: reload
stdin, stdout, stderr = ssh.exec_command("sudo nginx -s reload", timeout=10)
err = stderr.read().decode().strip()
print('reload:', 'OK' if not err else err)

# Step 4: 检查 /erp/ location 存在
stdin, stdout, stderr = ssh.exec_command("grep -c 'location ^~ /erp' /etc/nginx/sites-enabled/meoo", timeout=10)
print('/erp/ exists:', stdout.read().decode().strip())

ssh.close()
print('✅ done')
