import socket, time, sys, os

proxy = socket.socket()
proxy.connect(('127.0.0.1', 18080))
proxy.send(b'CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n')
resp = b''
while b'\r\n\r\n' not in resp:
    chunk = proxy.recv(4096)
    if not chunk: break
    resp += chunk
time.sleep(0.5)

import paramiko
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('43.133.232.81', username='ubuntu', password='yuan340364#', sock=proxy)
print("✅ SSH connected")

# 清理旧 dist，上传新的 dist 目录
sftp = ssh.open_sftp()

dist_local = '/workspace/wms-app/dist'
dist_remote = '/home/ubuntu/wms-dist'

# 先删远端旧的
try:
    ssh.exec_command(f"rm -rf {dist_remote} && mkdir -p {dist_remote}")
    time.sleep(0.5)
except: pass

# 上传 index.html
for root, dirs, files in os.walk(dist_local):
    rel = os.path.relpath(root, dist_local)
    remote_dir = f"{dist_remote}/{rel}" if rel != '.' else dist_remote
    try:
        sftp.stat(remote_dir)
    except:
        sftp.mkdir(remote_dir)
    for f in files:
        local_f = os.path.join(root, f)
        remote_f = f"{remote_dir}/{f}"
        sftp.put(local_f, remote_f)
        print(f"  ⬆ {local_f}")

sftp.close()
print("✅ 上传完成")

# 同步到 /var/www/wms
stdin, stdout, stderr = ssh.exec_command(
    f"sudo rm -rf /var/www/wms/* && sudo cp -r {dist_remote}/* /var/www/wms/ && sudo chmod -R 755 /var/www/wms/",
    timeout=30
)
out = stdout.read().decode()
err = stderr.read().decode()
print("同步 /var/www/wms:", out.strip() or "OK")
if err.strip(): print("ERR:", err.strip()[:500])

# 验证 nginx 在跑
stdin, stdout, stderr = ssh.exec_command("curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:80/ 2>&1")
code = stdout.read().decode().strip()
print(f"✅ nginx health: {code}")

ssh.close()
print("\n🎉 部署完成!")
