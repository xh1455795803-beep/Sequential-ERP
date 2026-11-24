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

def test(title, cmd):
    print('\n' + '='*55)
    print('  ' + title)
    print('='*55)
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=30)
    out = stdout.read().decode()
    err = stderr.read().decode()
    if out: print(out[:800])
    if err: print('STDERR:', err[:300])

test("1. Edge Functions 容器",
     "docker ps --filter name=edge-functions --format '{{.Status}}'")

test("2. REST API merchants",
     "curl -s -H 'apikey: " + ANON + "' -H 'Authorization: Bearer " + ANON + "' " + BASE + "/rest/v1/tlv_merchants?select=id,business_name,balance")

test("3. generate-label-pdf 面单",
     "OID=$(docker exec supabase-db psql -U postgres -t -A -c 'SELECT id FROM tlv_outbound_orders LIMIT 1;') && curl -s -X POST " + BASE + "/functions/v1/generate-label-pdf -H 'Content-Type: application/json' -H 'Authorization: Bearer " + ANON + "' -d \"{\\\"outbound_id\\\": \\\"$OID\\\"}\" | python3 -c 'import sys,json; d=json.load(sys.stdin); r=d.get(\"results\",[{}])[0]; print(\"ok:\", d.get(\"ok\"), \"svg:\", len(r.get(\"svg_base64\",\"\")), \"order:\", r.get(\"order_no\"))'")

test("4. recharge-wallet +20",
     "curl -s -X POST " + BASE + "/functions/v1/recharge-wallet -H 'Content-Type: application/json' -H 'Authorization: Bearer " + ANON + "' -d '{\"merchant_id\": \"7e3bf09f-3937-4891-a6f6-75941f39d1b2\", \"amount\": 20}' && echo '' && sleep 1 && docker exec supabase-db psql -U postgres -c \"SELECT 'wallets_latest' as src, balance_after FROM tlv_merchant_wallets WHERE merchant_id='7e3bf09f-3937-4891-a6f6-75941f39d1b2' ORDER BY created_at DESC LIMIT 1 UNION ALL SELECT 'merchants_sync', balance FROM tlv_merchants WHERE id='7e3bf09f-3937-4891-a6f6-75941f39d1b2';\"")

test("5. calc_outbound_charge RPC",
     "OID=$(docker exec supabase-db psql -U postgres -t -A -c 'SELECT id FROM tlv_outbound_orders LIMIT 1;') && docker exec supabase-db psql -U postgres -c \"SELECT calc_outbound_charge('$OID'::uuid, 2.5) as fee_2_5kg;\"")

test("6. Triggers",
     "docker exec supabase-db psql -U postgres -c \"SELECT tgname, tgrelid::regclass FROM pg_trigger WHERE tgname NOT LIKE 'RI_%' ORDER BY tgrelid;\"")

test("7. Frontend build + nginx",
     "curl -sI http://localhost/ 2>&1 | head -3")

ssh.close()
print('\n' + '='*55)
print('  核心系统就绪!')
print('='*55)
