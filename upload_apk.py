#!/usr/bin/env python3
"""上传 APK 到 thalvior.fun 服务器"""
import socket, sys, os, time

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
        raise Exception(f"Proxy CONNECT failed: {resp[:200]}")
    return sock

try:
    import paramiko
except ImportError:
    print("Installing paramiko...")
    os.system(f"{sys.executable} -m pip install paramiko")
    import paramiko

APK_LOCAL = '/workspace/thalvior-wms-v1.0.1.apk'
SERVER = '43.133.232.81'
USER = 'ubuntu'
PASS = 'Yuan340364#'

print(f"Connecting to {SERVER}:22 via proxy...")
sock = proxy_connect(SERVER, 22)

transport = paramiko.Transport(sock)
transport.connect(username=USER, password=PASS)
ssh = paramiko.SSHClient()
ssh._transport = transport
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

print("Opening SFTP...")
sftp = paramiko.SFTPClient.from_transport(transport)

# Step 1: Upload to /tmp/ first (direct SFTP to web root sometimes silently fails)
remote_tmp = f'/tmp/thalvior-wms-v1.0.1.apk'
print(f"Uploading to {remote_tmp}...")
start = time.time()
sftp.put(APK_LOCAL, remote_tmp)
elapsed = time.time() - start
size_mb = os.path.getsize(APK_LOCAL) / (1024*1024)
print(f"Uploaded {size_mb:.1f}MB in {elapsed:.1f}s ({size_mb/elapsed:.1f} MB/s)")

# Step 2: sudo mv to web root
commands = [
    f'sudo cp {remote_tmp} /var/www/thalvior/app/thalvior-wms-v1.0.1.apk',
    f'sudo cp {remote_tmp} /var/www/thalvior/app/thalvior-wms-release.apk',
    f'sudo chown www-data:www-data /var/www/thalvior/app/*.apk',
    f'ls -la /var/www/thalvior/app/',
]
for cmd in commands:
    print(f"$ {cmd}")
    stdin, stdout, stderr = ssh.exec_command(cmd)
    out = stdout.read().decode()
    err = stderr.read().decode()
    if out: print(out)
    if err: print(f"ERR: {err}")

sftp.close()
transport.close()

print("\n✅ Upload done!")
print("Download URLs:")
print("  https://thalvior.fun/app/thalvior-wms-v1.0.1.apk")
print("  https://thalvior.fun/app/thalvior-wms-release.apk")
