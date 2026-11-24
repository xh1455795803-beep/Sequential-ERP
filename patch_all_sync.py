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

# Full rewrite each sync function with correct column names
fix_script = r"""
for fn in sync-tiktok-orders sync-shopee-orders sync-lazada-orders sync-ozon-orders sync-mercado-orders sync-logistics-tracking; do
  f=/opt/supabase/docker/volumes/functions/$fn/index.ts
  if [ -f "$f" ]; then
    # 1. Fix outbound_order_id -> outbound_id in tlv_outbound_items inserts
    sed -i 's/outbound_order_id/outbound_id/g' "$f"
    # 2. Add source, receiver_city, receiver_country after receiver_address in tlv_outbound_orders inserts
    if ! grep -q "source.*edge-sync\|source.*'api'" "$f"; then
      sed -i '/receiver_address: generateAddr(),/a\          source: '\''edge-sync'\'',\n          receiver_city: '\''Unknown'\'',\n          receiver_country: '\''US'\'',\n          receiver_state: '\''Unknown'\'',\n          receiver_postal_code: '\''00000'\'',\n          merchant_name: merchant_name || '\'''\'',' "$f" 2>/dev/null || true
    fi
    echo "=== $fn after patch ===" 
    head -100 "$f" | grep -n 'source:\|outbound_id:\|receiver_city'
  fi
done
docker restart supabase-edge-functions 2>&1 | tail -3
sleep 6
docker ps --filter name=edge-functions --format '{{.Status}}'
"""

stdin, stdout, stderr = ssh.exec_command(fix_script)
print(stdout.read().decode())
err = stderr.read().decode()
if err: print('STDERR:', err[:1000])

# Test sync
ANON = 'eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw'
test_cmd = """
BEFORE=$(docker exec supabase-db psql -U postgres -t -A -c 'SELECT count(*) FROM tlv_outbound_orders;')
echo "before=$BEFORE"
curl -s -X POST https://thalvior.icu/functions/v1/sync-tiktok-orders -H 'Content-Type: application/json' -H 'Authorization: Bearer """ + ANON + """' -d '{"merchant_id": "7e3bf09f-3937-4891-a6f6-75941f39d1b2"}'
echo ""
AFTER=$(docker exec supabase-db psql -U postgres -t -A -c 'SELECT count(*) FROM tlv_outbound_orders;')
echo "after=$AFTER"
echo "--- newest orders ---"
docker exec supabase-db psql -U postgres -c "SELECT order_no, source, platform, status, estimated_fee, balance_deducted FROM tlv_outbound_orders ORDER BY created_at DESC LIMIT 10;"
"""
print('\n=== Test sync ===')
stdin, stdout, stderr = ssh.exec_command(test_cmd)
print(stdout.read().decode())
err = stderr.read().decode()
if err: print('STDERR:', err[:500])

ssh.close()
