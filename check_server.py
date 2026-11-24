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
    "echo '=== Docker containers ===' && docker ps -a --format 'table {{.Names}}\t{{.Status}}'",
    "echo '=== Edge Functions logs ===' && docker logs supabase-edge-functions --tail 30 2>&1 || echo 'no logs'",
    "echo '=== RPC check ===' && docker exec supabase-db psql -U postgres -c \"SELECT proname FROM pg_proc WHERE proname LIKE '%charge%' OR proname LIKE '%outbound%' OR proname LIKE '%balance%'\" 2>&1",
    "echo '=== Tables check ===' && docker exec supabase-db psql -U postgres -c \"SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename\" 2>&1",
    "echo '=== Issue items columns ===' && docker exec supabase-db psql -U postgres -c \"\\d tlv_issue_items\" 2>&1",
]
for c in cmds:
    print()
    print(cmds.index(c))
    stdin, stdout, stderr = ssh.exec_command(c)
    print(stdout.read().decode())
    err = stderr.read().decode()
    if err: print('STDERR:', err[:500])

ssh.close()
