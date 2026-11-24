import socket, time, paramiko

proxy = socket.socket()
proxy.connect(('127.0.0.1', 18080))
proxy.send(b'CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n')
resp = b''
while b'\r\n\r\n' not in resp:
    chunk = proxy.recv(4096)
    if not chunk: break
    resp += chunk
time.sleep(0.8)

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('43.133.232.81', username='ubuntu', password='yuan340364#', sock=proxy)

# Copy main dir and deno.jsonc to mounted volume
cmd1 = """
sudo cp -r /opt/thalvior-source/functions/main /opt/supabase/docker/volumes/functions/ && \
sudo cp /opt/thalvior-source/functions/deno.jsonc /opt/supabase/docker/volumes/functions/ && \
sudo chown -R root:root /opt/supabase/docker/volumes/functions/ && \
echo '=== After copy ===' && \
ls -la /opt/supabase/docker/volumes/functions/ && \
echo '=== Restarting edge functions ===' && \
docker restart supabase-edge-functions && \
sleep 8 && \
echo '=== Status ===' && \
docker ps --filter name=edge-functions --format '{{.Status}}' && \
echo '=== Recent logs ===' && \
docker logs supabase-edge-functions --tail 20
"""
print('Deploying main-service + deno.jsonc...')
stdin, stdout, stderr = ssh.exec_command(cmd1)
print(stdout.read().decode())
err = stderr.read().decode()
if err: print('STDERR:', err[:1000])

ssh.close()
