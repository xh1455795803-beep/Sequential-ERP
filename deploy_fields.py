#!/usr/bin/env python3
"""部署 wms-app dist 到服务器 /var/www/wms/"""
import paramiko, socket, time, os, sys

def make_conn():
    for attempt in range(15):
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.connect(('127.0.0.1', 18080))
            time.sleep(1.5)
            transport = paramiko.Transport(sock)
            transport.connect(username='ubuntu', password='yuan340364#')
            return transport
        except Exception as e:
            print(f'  attempt {attempt+1} failed: {e}')
            time.sleep(2)
    raise Exception('SSH tunnel failed after 15 attempts')

LOCAL_DIST = '/workspace/wms-app/dist'
REMOTE_BASE = '/var/www/wms'

trans = make_conn()
sftp = paramiko.SFTPClient.from_transport(trans)

def ensure_dir(remote_path):
    parts = remote_path.split('/')
    cur = ''
    for p in parts:
        cur += '/' + p
        if not cur:
            continue
        try:
            sftp.stat(cur)
        except FileNotFoundError:
            sftp.mkdir(cur)
            print(f'  mkdir {cur}')

for root, dirs, files in os.walk(LOCAL_DIST):
    rel_root = os.path.relpath(root, LOCAL_DIST)
    remote_dir = REMOTE_BASE if rel_root == '.' else f'{REMOTE_BASE}/{rel_root}'
    ensure_dir(remote_dir)
    for f in files:
        local = os.path.join(root, f)
        remote = f'{remote_dir}/{f}'
        sftp.put(local, remote)
        print(f'uploaded {os.path.relpath(local, LOCAL_DIST)}')

sftp.close()

# nginx reload
ssh = trans.open_session()
ssh.exec_command('sudo nginx -s reload')
ssh.wait()
print('nginx reloaded')

trans.close()
print(f'\n✅ 部署完成: thalvior.icu/{REMOTE_BASE.replace("/var/www/","")}/')
