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

# Upload fix script
script = '''import os
base = '/opt/supabase/docker/volumes/functions'
for fn in ['sync-tiktok-orders/index.ts','sync-shopee-orders/index.ts','sync-lazada-orders/index.ts','sync-ozon-orders/index.ts','sync-mercado-orders/index.ts']:
    p = os.path.join(base, fn)
    if os.path.exists(p):
        c = open(p).read()
        old = "merchant_name: merchant_name || 'Demo Merchant'"
        new = "merchant_name: 'Demo Merchant'"
        if old in c:
            c = c.replace(old, new)
            open(p, 'w').write(c)
            print(f'Fixed: {fn}')
        else:
            print(f'No match: {fn}')
'''

sftp = ssh.open_sftp()
with sftp.file('/tmp/fix2.py', 'w') as f:
    f.write(script)
sftp.close()

cmds = [
    'sudo python3 /tmp/fix2.py',
    'sudo docker restart supabase-edge-functions 2>&1 && sleep 6',
    'sudo docker ps --filter name=edge-functions --format "{{.Status}}"',
]
for c in cmds:
    stdin, stdout, stderr = ssh.exec_command(c)
    print(stdout.read().decode())
    err = stderr.read().decode()
    if err: print('STDERR:', err[:500])

# Test 
ANON = 'eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw'
test_cmd = 'BEFORE=$(docker exec supabase-db psql -U postgres -t -A -c "SELECT count(*) FROM tlv_outbound_orders;") && echo "before=$BEFORE" && curl -s -X POST https://thalvior.icu/functions/v1/sync-tiktok-orders -H "Content-Type: application/json" -H "Authorization: Bearer ' + ANON + '" -d \'{"merchant_id": "7e3bf09f-3937-4891-a6f6-75941f39d1b2"}\' && echo "" && AFTER=$(docker exec supabase-db psql -U postgres -t -A -c "SELECT count(*) FROM tlv_outbound_orders;") && echo "after=$AFTER" && echo "--- Newest orders ---" && docker exec supabase-db psql -U postgres -c "SELECT order_no, source, status, estimated_fee, balance_deducted FROM tlv_outbound_orders ORDER BY created_at DESC LIMIT 10;"'
print('\n=== Test sync ===')
stdin, stdout, stderr = ssh.exec_command(test_cmd)
print(stdout.read().decode())
err = stderr.read().decode()
if err: print('STDERR:', err[:500])

ssh.close()
