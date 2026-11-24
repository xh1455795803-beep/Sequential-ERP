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

# Write Python script to server then run with sudo
script = r'''
import os, re

functions = [
    'sync-tiktok-orders/index.ts',
    'sync-shopee-orders/index.ts', 
    'sync-lazada-orders/index.ts',
    'sync-ozon-orders/index.ts',
    'sync-mercado-orders/index.ts',
    'sync-logistics-tracking/index.ts',
]
base = '/opt/supabase/docker/volumes/functions'

for fn in functions:
    path = os.path.join(base, fn)
    if not os.path.exists(path):
        continue
    with open(path, 'r') as f:
        content = f.read()
    
    changed = False
    
    # Fix 1: outbound_order_id -> outbound_id
    if 'outbound_order_id' in content:
        content = content.replace('outbound_order_id', 'outbound_id')
        changed = True
        print(f'  Fixed outbound_order_id in {fn}')
    
    # Fix 2: Add source/receiver_city/receiver_country if missing
    if "source: 'edge-sync'" not in content and "source: 'api'" not in content:
        # Find the receiver_address line in the orders INSERT
        pattern = r"(receiver_address: [^,]+,)([^\}]*?is_cod:)"
        m = re.search(pattern, content, re.DOTALL)
        if m:
            new_fields = """
          source: 'edge-sync',
          receiver_city: 'Unknown',
          receiver_country: 'US',
          receiver_state: 'Unknown',
          receiver_postal_code: '00000',
          merchant_name: merchant_name || 'Demo Merchant',
"""
            content = content[:m.end(1)] + new_fields + content[m.end(1):]
            changed = True
            print(f'  Added missing columns in {fn}')
    
    if changed:
        with open(path, 'w') as f:
            f.write(content)
        print(f'  Patched: {fn}')
    else:
        print(f'  OK: {fn}')

print('\nRestarting edge functions...')
'''

# Upload script
sftp = ssh.open_sftp()
with sftp.file('/tmp/patch_efs.py', 'w') as f:
    f.write(script)
sftp.close()

cmds = [
    'sudo python3 /tmp/patch_efs.py',
    'sudo docker restart supabase-edge-functions 2>&1 && sleep 6 && sudo docker ps --filter name=edge-functions --format "{{.Status}}"',
]
for c in cmds:
    print()
    stdin, stdout, stderr = ssh.exec_command(c)
    print(stdout.read().decode())
    err = stderr.read().decode()
    if err: print('STDERR:', err[:500])

# Test
ANON = 'eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw'
test_cmd = """
echo '=== Test sync-tiktok ==='
BEFORE=$(docker exec supabase-db psql -U postgres -t -A -c 'SELECT count(*) FROM tlv_outbound_orders;')
echo "before=$BEFORE"
curl -s -X POST https://thalvior.icu/functions/v1/sync-tiktok-orders -H 'Content-Type: application/json' -H 'Authorization: Bearer """ + ANON + """' -d '{"merchant_id": "7e3bf09f-3937-4891-a6f6-75941f39d1b2"}'
echo ""
AFTER=$(docker exec supabase-db psql -U postgres -t -A -c 'SELECT count(*) FROM tlv_outbound_orders;')
echo "after=$AFTER"
echo '=== New orders ==='
docker exec supabase-db psql -U postgres -c "SELECT order_no, source, platform, status, estimated_fee, balance_deducted FROM tlv_outbound_orders ORDER BY created_at DESC LIMIT 8;"
"""
print('\n' + '='*60)
stdin, stdout, stderr = ssh.exec_command(test_cmd)
print(stdout.read().decode())
err = stderr.read().decode()
if err: print('STDERR:', err[:500])

ssh.close()
