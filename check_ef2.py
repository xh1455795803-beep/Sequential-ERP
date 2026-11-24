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
    "echo '=== deno.jsonc ===' && cat /opt/thalvior-source/functions/deno.jsonc 2>&1",
    "echo '=== main dir ===' && ls -la /opt/thalvior-source/functions/main/ 2>&1",
    "echo '=== generate-label-pdf ===' && ls -la /opt/thalvior-source/functions/generate-label-pdf/ 2>&1 && echo '--- content ---' && head -5 /opt/thalvior-source/functions/generate-label-pdf/index.ts 2>&1",
    "echo '=== recharge-wallet ===' && head -10 /opt/thalvior-source/functions/recharge-wallet/index.ts 2>&1",
    "echo '=== sync-tiktok ===' && head -10 /opt/thalvior-source/functions/sync-tiktok-orders/index.ts 2>&1",
    "echo '=== docker volume check ===' && docker inspect supabase-edge-functions --format '{{json .Mounts}}' 2>&1 | python3 -m json.tool 2>&1",
]
for c in cmds:
    print()
    stdin, stdout, stderr = ssh.exec_command(c)
    print(stdout.read().decode())
    err = stderr.read().decode()
    if err: print('STDERR:', err[:500])

ssh.close()
