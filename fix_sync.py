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

# 1. Fix DB NOT NULL defaults so Edge Functions don't fail
sql = """
ALTER TABLE tlv_outbound_orders ALTER COLUMN source SET DEFAULT 'api';
ALTER TABLE tlv_outbound_orders ALTER COLUMN receiver_city SET DEFAULT 'Unknown';
ALTER TABLE tlv_outbound_orders ALTER COLUMN receiver_country SET DEFAULT 'US';

-- Verify
SELECT column_name, column_default FROM information_schema.columns 
WHERE table_name='tlv_outbound_orders' AND (column_name IN ('source','receiver_city','receiver_country'));
"""

# 2. Also fix sync-tiktok Edge Function to include missing fields
patch = """
import socket, time, paramiko as P

p = socket.socket()
p.connect(('127.0.0.1', 18080))
p.send(b'CONNECT 43.133.232.81:22 HTTP/1.1\\r\\nHost: 43.133.232.81:22\\r\\n\\r\\n')
r = b''
while b'\\r\\n\\r\\n' not in r:
    c = p.recv(4096)
    if not c: break
    r += c
time.sleep(0.8)
s = P.SSHClient()
s.set_missing_host_key_policy(P.AutoAddPolicy())
s.connect('43.133.232.81', username='ubuntu', password='yuan340364#', sock=p)

# sed patch: add source + city + country to INSERT
cmd = \"\"\"sed -i \"/receiver_address: generateAddr(),/a\\\\          source: 'edge-sync',\\\\n          receiver_city: cities[Math.floor(Math.random()*6)],\\\\n          receiver_country: 'US',\" /opt/supabase/docker/volumes/functions/sync-tiktok-orders/index.ts && \
grep -n 'source:' /opt/supabase/docker/volumes/functions/sync-tiktok-orders/index.ts && \
docker restart supabase-edge-functions && sleep 6 && docker ps --filter name=edge-functions --format '{{.Status}}'\"\"\"
stdin, stdout, stderr = s.exec_command(cmd)
print(stdout.read().decode())
e = stderr.read().decode()
if e: print('STDERR:', e[:500])
s.close()
"""

# Run SQL first
print('=== DB fix ===')
cmd1 = f"""docker exec -i supabase-db psql -U postgres << 'SQLEOF'
{sql}
SQLEOF
"""
stdin, stdout, stderr = ssh.exec_command(cmd1)
print(stdout.read().decode())
err = stderr.read().decode()
if err: print('STDERR:', err[:500])

# Then test sync-tiktok
ANON = 'eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw'
cmd2 = "BEFORE=$(docker exec supabase-db psql -U postgres -t -A -c 'SELECT count(*) FROM tlv_outbound_orders;') && echo \"before=$BEFORE\" && curl -s -X POST https://thalvior.icu/functions/v1/sync-tiktok-orders -H 'Content-Type: application/json' -H 'Authorization: Bearer " + ANON + "' -d '{\"merchant_id\": \"7e3bf09f-3937-4891-a6f6-75941f39d1b2\"}' && echo '' && AFTER=$(docker exec supabase-db psql -U postgres -t -A -c 'SELECT count(*) FROM tlv_outbound_orders;') && echo \"after=$AFTER\""
print('\n=== Test sync-tiktok ===')
stdin, stdout, stderr = ssh.exec_command(cmd2)
print(stdout.read().decode())

ssh.close()
