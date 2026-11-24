#!/usr/bin/env python3
"""部署 WMS Web dist + APK"""
import paramiko, socket, tarfile, io, os, sys

SERVER = '43.133.232.81'
USER = 'ubuntu'
PASS = 'yuan340364#'

def proxy_connect(host, port, proxy_host='127.0.0.1', proxy_port=18080):
    sock = socket.socket(); sock.settimeout(30)
    sock.connect((proxy_host, proxy_port))
    sock.sendall(f"CONNECT {host}:{port} HTTP/1.1\r\nHost: {host}:{port}\r\n\r\n".encode())
    resp = b''
    while b'\r\n\r\n' not in resp:
        chunk = sock.recv(4096)
        if not chunk: break
        resp += chunk
    return sock

sock = proxy_connect(SERVER, 22)
transport = paramiko.Transport(sock)
transport.connect(username=USER, password=PASS)
ssh = paramiko.SSHClient()
ssh._transport = transport
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
sftp = paramiko.SFTPClient.from_transport(transport)

# --- 1. 部署 Web dist ---
print("=== 1. 部署 WMS Web ===")
buf = io.BytesIO()
with tarfile.open(fileobj=buf, mode='w') as tar:
    for root, dirs, files in os.walk('/workspace/wms-app/dist'):
        for f in files:
            local = os.path.join(root, f)
            arc = os.path.relpath(local, '/workspace/wms-app/dist')
            tar.add(local, arcname=arc)
buf.seek(0)

sftp.putfo(buf, '/tmp/wms_dist.tar.gz')
for cmd in [
    'sudo mkdir -p /var/www/thalvior/wms',
    'sudo rm -rf /var/www/thalvior/wms/*',
    'sudo tar xzf /tmp/wms_dist.tar.gz -C /var/www/thalvior/wms/',
    'sudo chown -R www-data:www-data /var/www/thalvior/wms/',
    'ls -la /var/www/thalvior/wms/ | head -10',
]:
    print(f"  $ {cmd}")
    stdin, stdout, stderr = ssh.exec_command(cmd)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    if out: print(f"  {out}")
    if err and 'warning' not in err.lower(): print(f"  ERR: {err}")

# --- 2. 部署 APK ---
apk_src = '/workspace/thalvior-wms-v1.0.2.apk'
if os.path.exists(apk_src):
    print("\n=== 2. 部署 APK ===")
    sftp.put(apk_src, '/tmp/thalvior-wms-pretty.apk')
    for cmd in [
        'sudo cp /tmp/thalvior-wms-pretty.apk /var/www/thalvior/app/thalvior-wms-v1.0.2.apk',
        'sudo cp /tmp/thalvior-wms-pretty.apk /var/www/thalvior/app/thalvior-wms-release.apk',
        'sudo chown www-data:www-data /var/www/thalvior/app/*.apk',
        'ls -la /var/www/thalvior/app/*.apk',
    ]:
        print(f"  $ {cmd}")
        stdin, stdout, stderr = ssh.exec_command(cmd)
        out = stdout.read().decode().strip()
        if out: print(f"  {out}")
else:
    print(f"\n⚠ APK 不存在: {apk_src}（新 gradle 还没跑完）")

sftp.close()
transport.close()
print("\n✅ 部署完成")
print("   Web: https://thalvior.fun/wms/")
print("   APK: https://thalvior.fun/app/thalvior-wms-v1.0.2.apk")
