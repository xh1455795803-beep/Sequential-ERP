#!/usr/bin/env python3
import socket, time

def proxy_connect(host, port, proxy_host='127.0.0.1', proxy_port=18080):
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(30)
    sock.connect((proxy_host, proxy_port))
    sock.sendall(f"CONNECT {host}:{port} HTTP/1.1\r\nHost: {host}:{port}\r\n\r\n".encode())
    resp = b''
    while b'\r\n\r\n' not in resp:
        chunk = sock.recv(4096)
        if not chunk: break
        resp += chunk
    if b'200' not in resp.split(b'\r\n')[0]:
        raise Exception(f"Proxy CONNECT failed")
    return sock

import paramiko

APK_LOCAL = '/workspace/thalvior-wms-v1.0.2.apk'
SERVER = '43.133.232.81'
USER = 'ubuntu'
PASS = 'Yuan340364#'

print(f"Connecting to {SERVER}...")
sock = proxy_connect(SERVER, 22)
transport = paramiko.Transport(sock)
transport.connect(username=USER, password=PASS)
ssh = paramiko.SSHClient()
ssh._transport = transport
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

sftp = paramiko.SFTPClient.from_transport(transport)

remote_tmp = '/tmp/thalvior-wms-v1.0.2.apk'
print(f"Uploading {APK_LOCAL} -> {remote_tmp}...")
start = time.time()
sftp.put(APK_LOCAL, remote_tmp)
print(f"Uploaded in {time.time()-start:.1f}s")

for cmd in [
    f'sudo cp {remote_tmp} /var/www/thalvior/app/thalvior-wms-v1.0.2.apk',
    f'sudo cp {remote_tmp} /var/www/thalvior/app/thalvior-wms-release.apk',
    f'sudo chown www-data:www-data /var/www/thalvior/app/*.apk',
    f'ls -la /var/www/thalvior/app/',
]:
    print(f"$ {cmd}")
    stdin, stdout, stderr = ssh.exec_command(cmd)
    out = stdout.read().decode()
    err = stderr.read().decode()
    if out: print(out)
    if err: print(f"ERR: {err}")

sftp.close()
transport.close()
print("\n✅ v1.0.2 上传完成")
print("URL: https://thalvior.fun/app/thalvior-wms-v1.0.2.apk")
