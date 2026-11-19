#!/usr/bin/env python3
import socket, paramiko, sys, os

def connect_via_http_proxy(host, port):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.connect(('127.0.0.1', 18080))
    s.sendall(f"CONNECT {host}:{port} HTTP/1.1\r\nHost: {host}:{port}\r\n\r\n".encode())
    response = b''
    while b'\r\n\r\n' not in response:
        chunk = s.recv(4096)
        if not chunk: raise ConnectionError("Proxy closed")
        response += chunk
    status_line = response.split(b'\r\n')[0].decode()
    if '200' not in status_line: raise ConnectionError(f"Proxy failed: {status_line}")
    return s

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('43.133.232.81', port=22, username='ubuntu', password='Yuan340364#', sock=connect_via_http_proxy('43.133.232.81', 22), timeout=30)
sftp = client.open_sftp()

local_dist = '/workspace/wms-app/dist'
staging = '/home/ubuntu/wms-dist-staging'

stdin, stdout, stderr = client.exec_command(f"rm -rf {staging} && mkdir -p {staging}/assets")
stdout.read()

for fname in os.listdir(local_dist):
    local_path = os.path.join(local_dist, fname)
    remote_path = f"{staging}/{fname}"
    if os.path.isdir(local_path):
        for afname in os.listdir(local_path):
            sftp.put(os.path.join(local_path, afname), f"{remote_path}/{afname}")
            print(f"Uploaded assets/{afname}")
    else:
        sftp.put(local_path, remote_path)
        print(f"Uploaded {fname}")

move_cmd = f"sudo rm -rf /var/www/wms/* && sudo cp -r {staging}/* /var/www/wms/ && sudo chown -R www-data:www-data /var/www/wms && sudo chmod -R 755 /var/www/wms"
stdin, stdout, stderr = client.exec_command(move_cmd)
print(f"Move: {stdout.read().decode()}", stderr.read().decode())

# Verify
stdin, stdout, stderr = client.exec_command("ls /var/www/wms/assets/ && grep -o 'SFMyNTYiLCAidHlwIjogIkpXVCJ9' /var/www/wms/assets/index-*.js | head -1 || echo 'CHECK OK'")
print(stdout.read().decode())

sftp.close()
client.close()
print("DONE!")
