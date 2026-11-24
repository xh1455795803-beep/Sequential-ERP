import socket, time, os

proxy = socket.socket(); proxy.connect(('127.0.0.1', 18080))
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

# 打包 functions 目录
os.system("cd /workspace && tar czf /tmp/functions-v2.tgz functions/")
size = os.path.getsize('/tmp/functions-v2.tgz')
print(f"✅ tar {size} bytes")

# SCP
sftp = ssh.open_sftp()
sftp.put('/tmp/functions-v2.tgz', '/tmp/functions-v2.tgz')
sftp.close()
print("✅ SCP done")

# 上传到容器 & 重启
cmd = """
docker cp /tmp/functions-v2.tgz supabase-edge-functions:/tmp/functions.tgz && \
docker exec supabase-edge-functions sh -c "rm -rf /home/deno/functions/* && cd /home/deno && tar xzf /tmp/functions.tgz" && \
docker restart supabase-edge-functions
"""
_, out, err = ssh.exec_command(cmd, timeout=30)
print("=== Upload ===")
print(out.read().decode().strip() or "OK")
e = err.read().decode()
if e.strip(): print("ERR:", e.strip()[:500])

# 验证容器在跑
_, out, _ = ssh.exec_command("docker ps --format '{{.Names}} {{.Status}}' | grep edge")
print("\n=== Edge Functions ===")
print(out.read().decode().strip())

# 容器内函数列表
_, out, _ = ssh.exec_command("docker exec supabase-edge-functions ls -la /home/deno/functions/ 2>&1")
print("\n=== Container contents ===")
print(out.read().decode().strip())

ssh.close()
print("\n🎉 Edge Functions deployed!")
