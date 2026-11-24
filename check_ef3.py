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

cmds = [
    "echo '=== mounted functions dir ===' && ls -la /opt/supabase/docker/volumes/functions/ 2>&1 | head -40",
    "echo '=== count ===' && ls /opt/supabase/docker/volumes/functions/ 2>&1 | wc -l",
    "echo '=== has generate-label-pdf? ===' && ls /opt/supabase/docker/volumes/functions/generate-label-pdf/ 2>&1",
    "echo '=== has recharge-wallet? ===' && ls /opt/supabase/docker/volumes/functions/recharge-wallet/ 2>&1",
    "echo '=== has sync-tiktok? ===' && ls /opt/supabase/docker/volumes/functions/sync-tiktok-orders/ 2>&1",
    "echo '=== has sync-shopee? ===' && ls /opt/supabase/docker/volumes/functions/sync-shopee-orders/ 2>&1",
    "echo '=== has sync-logistics? ===' && ls /opt/supabase/docker/volumes/functions/sync-logistics-tracking/ 2>&1",
]
for c in cmds:
    print()
    stdin, stdout, stderr = ssh.exec_command(c)
    print(stdout.read().decode())
    err = stderr.read().decode()
    if err: print('STDERR:', err[:500])

ssh.close()
