#!/usr/bin/env python3
"""部署 wms-app dist — HTTP CONNECT proxy 方式"""
import socket, time, io, tarfile
import paramiko

HOST = '43.133.232.81'
PORT = 22
USER = 'ubuntu'
PASS = 'yuan340364#'
PROXY = ('127.0.0.1', 18080)
LOCAL_DIST = '/workspace/wms-app/dist'
REMOTE_WWW = '/var/www/wms'

def make_proxy_sock():
    sock = socket.socket()
    sock.settimeout(15)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    for attempt in range(15):
        try:
            sock.connect(PROXY)
            sock.sendall(f'CONNECT {HOST}:{PORT} HTTP/1.1\r\nHost: {HOST}:{PORT}\r\n\r\n'.encode())
            buf = b''
            while b'\r\n\r\n' not in buf:
                d = sock.recv(4096)
                if not d: break
                buf += d
            time.sleep(0.5)
            return sock
        except Exception as e:
            print(f'  proxy attempt {attempt+1} failed: {e}')
            try: sock.close()
            except: pass
            time.sleep(2)
    raise RuntimeError('proxy connect failed')

print('🔹 Connecting via HTTP CONNECT proxy...')
sock = make_proxy_sock()
t = paramiko.Transport(sock)
t.start_client()
t.auth_password(USER, PASS)
print(f'✅ SSH connected to {HOST}')

c = paramiko.SSHClient()
c._transport = t
c._sftp_live = False

# tar dist
buf = io.BytesIO()
with tarfile.open(fileobj=buf, mode='w:gz') as tar:
    tar.add(LOCAL_DIST, arcname='.')
buf.seek(0)
print(f'🔹 Packed dist into {buf.getbuffer().nbytes} bytes')

# upload
print('🔹 Uploading...')
sftp = c.open_sftp()
with sftp.file('/tmp/wms_update.tgz', 'wb') as f:
    f.write(buf.getvalue())
sftp.close()

# deploy
stdin, stdout, stderr = c.exec_command(f'sudo rm -rf {REMOTE_WWW} && sudo mkdir -p {REMOTE_WWW} && sudo tar xzf /tmp/wms_update.tgz -C {REMOTE_WWW} && sudo chown -R www-data:www-data {REMOTE_WWW} && sudo ln -sf {REMOTE_WWW}/assets /var/www/assets 2>/dev/null; sudo nginx -s reload 2>/dev/null; rm -f /tmp/wms_update.tgz; echo done', timeout=60)
out = stdout.read().decode()
err = stderr.read().decode()
rc = stdout.channel.recv_exit_status()
print(f'🔹 Deploy rc={rc}')
if err: print(f'  stderr: {err[:200]}')

# verify
stdin2, stdout2, _ = c.exec_command('curl -s -o /dev/null -w "%{http_code}" https://thalvior.icu/merchant/login')
print(f'🔹 https://thalvior.icu/merchant/login → HTTP {stdout2.read().decode().strip()}')

c.close()
print('✅ Done!')
