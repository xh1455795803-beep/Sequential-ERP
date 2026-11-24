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

# Patch all sync-* Edge Functions to include missing NOT NULL fields
# The common pattern: after `receiver_address: xxx,` we need to add source, receiver_city, receiver_country

functions_to_patch = [
    'sync-tiktok-orders', 'sync-shopee-orders', 'sync-lazada-orders', 
    'sync-ozon-orders', 'sync-mercado-orders'
]

for fn in functions_to_patch:
    print(f'\n=== Patching {fn} ===')
    path = f'/opt/supabase/docker/volumes/functions/{fn}/index.ts'
    # Check if already patched
    check_cmd = f"grep -c 'source:' {path} 2>/dev/null || echo 0"
    stdin, stdout, stderr = ssh.exec_command(check_cmd)
    count = stdout.read().decode().strip()
    
    if count == '0':
        # Patch: after `receiver_address: ...,` line, add source and city/country
        # Use Python on remote for precise editing
        patch_script = f"""python3 -c "
import re
with open('{path}', 'r') as f:
    content = f.read()

# Pattern: find the receiver_address line in the INSERT and add new fields
old = '''receiver_address: generateAddr(),
          is_cod: isCOD,'''
new = '''receiver_address: generateAddr(),
          source: 'edge-sync',
          receiver_city: cities[Math.floor(Math.random()*cities.length)],
          receiver_country: 'US',
          is_cod: isCOD,'''

if old in content:
    content = content.replace(old, new, 1)
    with open('{path}', 'w') as f:
        f.write(content)
    print('Patched OK')
else:
    print('Pattern not found - checking...')
    print(content[content.find('receiver_address'):content.find('receiver_address')+200] if 'receiver_address' in content else 'no receiver_address')
"
"""
        stdin, stdout, stderr = ssh.exec_command(patch_script)
        print(stdout.read().decode())
        err = stderr.read().decode()
        if err: print('STDERR:', err[:500])
    else:
        print('Already patched')

# Also fix tlv_outbound_items missing columns in sync functions (outbound_id vs outbound_order_id)
# Check what sync functions use
print('\n=== Checking tlv_outbound_items inserts ===')
check2 = "for f in /opt/supabase/docker/volumes/functions/sync-*/index.ts; do echo \"--- $f ---\"; grep -n 'outbound_' $f | head -5; done"
stdin, stdout, stderr = ssh.exec_command(check2)
print(stdout.read().decode())

ssh.close()
