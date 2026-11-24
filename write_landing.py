#!/usr/bin/env python3
"""写入 marketing landing — 直接 sudo tee 到 /var/www/landing/index.html"""
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

# 从本地文件读 landing html 然后通过 base64 传到远端
import base64
landing_html = open('/workspace/landing.html', 'w')  # 先占位 — 等下直接写
ssh.close()
print('placeholder')
