#!/usr/bin/env python3
"""重新 SSH 连 + nginx reload"""
import socket, time, paramiko

HOST = '43.133.232.81'
USER = 'ubuntu'
PASS = 'yuan340364#'

def connect():
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
    ssh.connect(HOST, username=USER, password=PASS, sock=proxy, timeout=15)
    return ssh

ssh = connect()
print('✅ connected')

stdin, stdout, stderr = ssh.exec_command("sudo nginx -t 2>&1", timeout=15)
print('nginx -t:', stdout.read().decode().strip(), stderr.read().decode().strip())

stdin, stdout, stderr = ssh.exec_command("sudo nginx -s reload 2>&1", timeout=15)
err = stderr.read().decode().strip()
print('reload:', 'OK ✅' if not err else err)

stdin, stdout, stderr = ssh.exec_command("grep -c 'location \\^~ /erp' /etc/nginx/sites-enabled/meoo", timeout=10)
print('/erp/ in config:', stdout.read().decode().strip())

ssh.close()
