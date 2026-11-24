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
    ("1. REST merchants",
     "curl -s -H 'apikey: " + ANON + "' -H 'Authorization: Bearer " + ANON + "' " + BASE + "/rest/v1/tlv_merchants?select=id,business_name,balance | head -c 300"),

    ("2. generate-label-pdf",
     "OID=$(docker exec supabase-db psql -U postgres -t -A -c 'SELECT id FROM tlv_outbound_orders LIMIT 1;') && curl -s -X POST " + BASE + "/functions/v1/generate-label-pdf -H 'Content-Type: application/json' -H 'Authorization: Bearer " + ANON + "' -d \"{\\\"outbound_id\\\": \\\"$OID\\\"}\" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(\"ok:\", d.get(\"ok\"), \"svg_len:\", len(d.get(\"results\",[{}])[0].get(\"svg_base64\",\"\")))'"),

    ("3. recharge-wallet +50",
     "curl -s -X POST " + BASE + "/functions/v1/recharge-wallet -H 'Content-Type: application/json' -H 'Authorization: Bearer " + ANON + "' -d '{\"merchant_id\": \"7e3bf09f-3937-4891-a6f6-75941f39d1b2\", \"amount\": 50}' && echo '' && sleep 1 && echo 'wallets:' && docker exec supabase-db psql -U postgres -c \"SELECT amount, balance_after FROM tlv_merchant_wallets WHERE merchant_id='7e3bf09f-3937-4891-a6f6-75941f39d1b2' ORDER BY created_at DESC LIMIT 2;\" && echo 'merchants:' && docker exec supabase-db psql -U postgres -c \"SELECT balance FROM tlv_merchants WHERE id='7e3bf09f-3937-4891-a6f6-75941f39d1b2';\""),

    ("4. sync-tiktok-orders",
     "BEFORE=$(docker exec supabase-db psql -U postgres -t -A -c 'SELECT count(*) FROM tlv_outbound_orders;') && curl -s -X POST " + BASE + "/functions/v1/sync-tiktok-orders -H 'Content-Type: application/json' -H 'Authorization: Bearer " + ANON + "' -d '{\"merchant_id\": \"7e3bf09f-3937-4891-a6f6-75941f39d1b2\"}' | python3 -c 'import sys,json; d=json.load(sys.stdin); print(\"ok:\", d.get(\"ok\"), \"orders:\", d.get(\"count\"))' && AFTER=$(docker exec supabase-db psql -U postgres -t -A -c 'SELECT count(*) FROM tlv_outbound_orders;') && echo \"before=$BEFORE after=$AFTER\""),

    ("5. sync-logistics-tracking",
     "OID=$(docker exec supabase-db psql -U postgres -t -A -c 'SELECT id FROM tlv_outbound_orders ORDER BY created_at DESC LIMIT 1;') && curl -s -X POST " + BASE + "/functions/v1/sync-logistics-tracking -H 'Content-Type: application/json' -H 'Authorization: Bearer " + ANON + "' -d \"{\\\"outbound_id\\\": \\\"$OID\\\"}\" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(\"ok:\", d.get(\"ok\"), \"tracks:\", len(d.get(\"tracks\",[])))'"),

    ("6. calc_outbound_charge RPC",
     "OID=$(docker exec supabase-db psql -U postgres -t -A -c 'SELECT id FROM tlv_outbound_orders LIMIT 1;') && docker exec supabase-db psql -U postgres -c \"SELECT calc_outbound_charge('$OID'::uuid, 1.5) as fee;\""),

    ("7. Edge Functions health",
     "docker ps --filter name=edge-functions --format '{{.Status}}'"),
]

for title, c in cmds:
    print(f"\n{'='*20} {title} {'='*20}")
    stdin, stdout, stderr = ssh.exec_command(c)
    out = stdout.read().decode()
    err = stderr.read().decode()
    if out: print(out[:1500])
    if err: print('STDERR:', err[:500])

ssh.close()
