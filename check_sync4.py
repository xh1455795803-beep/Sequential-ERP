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

ANON = 'eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw'
BASE = 'https://thalvior.icu'

cmds = [
    # Full raw response
    "curl -s -X POST " + BASE + "/functions/v1/sync-tiktok-orders -H 'Content-Type: application/json' -H 'Authorization: Bearer " + ANON + "' -d '{\"merchant_id\": \"7e3bf09f-3937-4891-a6f6-75941f39d1b2\"}'",
    "docker exec supabase-db psql -U postgres -c \"SELECT order_no, platform, status FROM tlv_outbound_orders ORDER BY created_at DESC LIMIT 15;\"",
    "echo '--- balance_hold trigger test ---' && docker exec supabase-db psql -U postgres -c \"SELECT proname, pg_get_functiondef(oid) FROM pg_proc WHERE proname='tlv_deduct_balance_on_create';\" 2>&1 | head -20",
]
for c in cmds:
    print()
    print("=" * 50)
    stdin, stdout, stderr = ssh.exec_command(c)
    print(stdout.read().decode())
    err = stderr.read().decode()
    if err: print('STDERR:', err[:500])

ssh.close()
