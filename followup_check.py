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

# Why sync-tiktok 0? — 检查 merchant1 的 inventory 有哪些 SKU
run("sync-tiktok: merchant1 inventory",
    "docker exec supabase-db psql -U postgres -c \"SELECT sku, qty_on_hand FROM tlv_merchant_inventory WHERE merchant_id='7e3bf09f-3937-4891-a6f6-75941f39d1b2';\"")
run("sync-tiktok: merchant2 inventory",
    "docker exec supabase-db psql -U postgres -c \"SELECT sku, qty_on_hand FROM tlv_merchant_inventory WHERE merchant_id='c657a6a3-0b47-4a01-bbf2-5a0ce40a08d5';\"")

# sync-tiktok 函数用的 SKU 列表是 ['SKU-001', 'SKU-002', 'SKU-003']
# merchant1 有 SKU-001, SKU-002, SKU-003 ✅
# 那应该能插入啊... 让我看 sync-tiktok 源文件有没有问题
run("sync-tiktok 源文件关键段",
    "grep -n 'validItems\\|generateItems\\|sku' /opt/supabase/docker/volumes/functions/sync-tiktok-orders/index.ts | head -10")

# 用 merchant1 再调一次 sync-tiktok
run("sync-tiktok 用 merchant1 (详细)",
    "curl -s -X POST " + BASE + "/functions/v1/sync-tiktok-orders " +
    "-H 'Content-Type: application/json' -H 'Authorization: Bearer " + ANON + "' " +
    "-d '{\"merchant_id\": \"7e3bf09f-3937-4891-a6f6-75941f39d1b2\", \"debug\": true}' 2>&1")

# sync-lazada (新的一个)
run("sync-lazada-orders",
    "BEFORE=$(docker exec supabase-db psql -U postgres -t -A -c 'SELECT count(*) FROM tlv_outbound_orders;') && " +
    "curl -s -X POST " + BASE + "/functions/v1/sync-lazada-orders " +
    "-H 'Content-Type: application/json' -H 'Authorization: Bearer " + ANON + "' " +
    "-d '{\"merchant_id\": \"7e3bf09f-3937-4891-a6f6-75941f39d1b2\"}' 2>&1 && echo '' && " +
    "AFTER=$(docker exec supabase-db psql -U postgres -t -A -c 'SELECT count(*) FROM tlv_outbound_orders;') && " +
    "echo \"orders: before=$BEFORE after=$AFTER delta=$((AFTER-BEFORE))\"")

# sync-ozon
run("sync-ozon-orders",
    "BEFORE=$(docker exec supabase-db psql -U postgres -t -A -c 'SELECT count(*) FROM tlv_outbound_orders;') && " +
    "curl -s -X POST " + BASE + "/functions/v1/sync-ozon-orders " +
    "-H 'Content-Type: application/json' -H 'Authorization: Bearer " + ANON + "' " +
    "-d '{\"merchant_id\": \"c657a6a3-0b47-4a01-bbf2-5a0ce40a08d5\"}' 2>&1 && echo '' && " +
    "AFTER=$(docker exec supabase-db psql -U postgres -t -A -c 'SELECT count(*) FROM tlv_outbound_orders;') && " +
    "echo \"orders: before=$BEFORE after=$AFTER delta=$((AFTER-BEFORE))\"")

# 现在订单状态
run("当前所有订单",
    "docker exec supabase-db psql -U postgres -c \"SELECT order_no, source, platform, status, estimated_fee, balance_deducted FROM tlv_outbound_orders ORDER BY created_at DESC;\"")

# calc_outbound_charge RPC 用正确方式
run("calc_outbound_charge RPC",
    "OID=$(docker exec supabase-db psql -U postgres -t -A -c 'SELECT id FROM tlv_outbound_orders LIMIT 1;') && echo \"OID=$OID\" && " +
    "docker exec supabase-db psql -U postgres -c \"SELECT calc_outbound_charge('$OID'::uuid, 1.8) as fee;\"")

ssh.close()
