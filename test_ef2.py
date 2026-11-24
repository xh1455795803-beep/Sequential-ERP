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
    # Get real outbound order IDs
    "docker exec supabase-db psql -U postgres -c \"SELECT id, order_no, status, receiver_name, carrier FROM tlv_outbound_orders LIMIT 5;\" 2>&1",
    # Test with real order
    "OID=$(docker exec supabase-db psql -U postgres -t -A -c \"SELECT id FROM tlv_outbound_orders LIMIT 1;\") && echo \"OID=$OID\" && curl -s -X POST https://thalvior.icu/functions/v1/generate-label-pdf -H 'Content-Type: application/json' -H 'Authorization: Bearer eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw' -d \"{\\\"outbound_id\\\": \\\"$OID\\\"}\" 2>&1 | head -c 800",
    # Test recharge-wallet
    "curl -s -X POST https://thalvior.icu/functions/v1/recharge-wallet -H 'Content-Type: application/json' -H 'Authorization: Bearer eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw' -d '{\"merchant_id\": \"7e3bf09f-3937-4891-a6f6-75941f39d1b2\", \"amount\": 100}' 2>&1 | head -c 500",
]
for c in cmds:
    print()
    stdin, stdout, stderr = ssh.exec_command(c)
    print(stdout.read().decode())
    err = stderr.read().decode()
    if err: print('STDERR:', err[:500])

ssh.close()
