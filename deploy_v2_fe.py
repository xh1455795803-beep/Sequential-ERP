import socket, time, os

proxy = socket.socket()
proxy.connect(('127.0.0.1', 18080))
proxy.send(b'CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n')
resp = b''
for _ in range(5):
    chunk = proxy.recv(4096)
    if chunk: resp += chunk
    if b'\r\n\r\n' in resp: break
time.sleep(0.5)
import paramiko
ssh = paramiko.SSHClient(); ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('43.133.232.81', username='ubuntu', password='yuan340364#', sock=proxy)
print("✅ SSH")

sftp = ssh.open_sftp()
local = '/workspace/wms-app/dist'
for root, dirs, files in os.walk(local):
    rel = os.path.relpath(root, local)
    remote = f"/home/ubuntu/wms-dist/{rel}" if rel != '.' else '/home/ubuntu/wms-dist'
    try: sftp.stat(remote)
    except: sftp.mkdir(remote)
    for f in files:
        sftp.put(os.path.join(root, f), f"{remote}/{f}")
sftp.close()
print("✅ dist uploaded")

_, out, _ = ssh.exec_command("sudo rm -rf /var/www/wms/* && sudo cp -r /home/ubuntu/wms-dist/* /var/www/wms/ && sudo chmod -R 755 /var/www/wms/")
print("同步: OK")

_, out, _ = ssh.exec_command("curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:80/")
print("nginx health:", out.read().decode().strip())
ssh.close()
print("\n🎉 部署完成!")
