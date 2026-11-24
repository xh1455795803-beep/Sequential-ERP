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

def run(label, cmd):
    print('\n[' + label + ']')
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=60)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    if out:
        print(out[:1200])
    if err and 'NOTICE' not in err:
        print('STDERR:', err[:500])

# 用 merchant2 测 sync-tiktok（merchant2 对 shopee/ozon 成功过）
run("sync-tiktok → merchant2 (应该成功)",
    "BEFORE=$(docker exec supabase-db psql -U postgres -t -A -c 'SELECT count(*) FROM tlv_outbound_orders;') && " +
    "curl -s -X POST " + BASE + "/functions/v1/sync-tiktok-orders " +
    "-H 'Content-Type: application/json' -H 'Authorization: Bearer " + ANON + "' " +
    "-d '{\"merchant_id\": \"c657a6a3-0b47-4a01-bbf2-5a0ce40a08d5\"}' 2>&1 && echo '' && " +
    "AFTER=$(docker exec supabase-db psql -U postgres -t -A -c 'SELECT count(*) FROM tlv_outbound_orders;') && " +
    "echo \"orders: before=$BEFORE after=$AFTER delta=$((AFTER-BEFORE))\"")

run("sync-lazada → merchant2",
    "BEFORE=$(docker exec supabase-db psql -U postgres -t -A -c 'SELECT count(*) FROM tlv_outbound_orders;') && " +
    "curl -s -X POST " + BASE + "/functions/v1/sync-lazada-orders " +
    "-H 'Content-Type: application/json' -H 'Authorization: Bearer " + ANON + "' " +
    "-d '{\"merchant_id\": \"c657a6a3-0b47-4a01-bbf2-5a0ce40a08d5\"}' 2>&1 && echo '' && " +
    "AFTER=$(docker exec supabase-db psql -U postgres -t -A -c 'SELECT count(*) FROM tlv_outbound_orders;') && " +
    "echo \"orders: before=$BEFORE after=$AFTER delta=$((AFTER-BEFORE))\"")

# sync-mercado
run("sync-mercado → merchant2",
    "BEFORE=$(docker exec supabase-db psql -U postgres -t -A -c 'SELECT count(*) FROM tlv_outbound_orders;') && " +
    "curl -s -X POST " + BASE + "/functions/v1/sync-mercado-orders " +
    "-H 'Content-Type: application/json' -H 'Authorization: Bearer " + ANON + "' " +
    "-d '{\"merchant_id\": \"c657a6a3-0b47-4a01-bbf2-5a0ce40a08d5\"}' 2>&1 && echo '' && " +
    "AFTER=$(docker exec supabase-db psql -U postgres -t -A -c 'SELECT count(*) FROM tlv_outbound_orders;') && " +
    "echo \"orders: before=$BEFORE after=$AFTER delta=$((AFTER-BEFORE))\"")

# sync-logistics-tracking 用正确 UUID
run("sync-logistics-tracking",
    "OID=$(docker exec supabase-db psql -U postgres -t -A -c 'SELECT id FROM tlv_outbound_orders ORDER BY created_at DESC LIMIT 1;') && echo \"OID=$OID\" && " +
    "BEFORE=$(docker exec supabase-db psql -U postgres -t -A -c \"SELECT count(*) FROM tlv_logistics_tracking WHERE outbound_id='$OID';\") && " +
    "curl -s -X POST " + BASE + "/functions/v1/sync-logistics-tracking " +
    "-H 'Content-Type: application/json' -H 'Authorization: Bearer " + ANON + "' " +
    "-d \"{\\\"outbound_id\\\": \\\"$OID\\\"}\" 2>&1 && echo '' && " +
    "AFTER=$(docker exec supabase-db psql -U postgres -t -A -c \"SELECT count(*) FROM tlv_logistics_tracking WHERE outbound_id='$OID';\") && " +
    "echo \"tracking: before=$BEFORE after=$AFTER\"")

# 最终订单表
run("最终所有订单",
    "docker exec supabase-db psql -U postgres -c \"SELECT order_no, source, platform, status, estimated_fee, balance_deducted FROM tlv_outbound_orders ORDER BY created_at DESC;\"")

ssh.close()
