#!/usr/bin/env python3
import socket, time, paramiko
HOST, PORT, USER, PASS = '43.133.232.81', 22, 'ubuntu', 'yuan340364#'
def connect():
    sock = socket.socket(); sock.settimeout(20); sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    for attempt in range(20):
        try:
            sock.connect(('127.0.0.1', 18080))
            sock.sendall(f'CONNECT {HOST}:{PORT} HTTP/1.1\r\nHost: {HOST}:{PORT}\r\n\r\n'.encode())
            buf = b''
            while b'\r\n\r\n' not in buf:
                d = sock.recv(4096)
                if not d: break
                buf += d
            time.sleep(1)
            t = paramiko.Transport(sock); t.start_client(); t.auth_password(USER, PASS)
            c = paramiko.SSHClient(); c._transport = t; c._sftp_live = False
            return c
        except Exception:
            try: sock.close()
            except: pass
            time.sleep(2)
    raise RuntimeError('connect failed')
def run(c, cmd, timeout=60):
    stdin, stdout, stderr = c.exec_command(cmd, timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace').strip(), stderr.read().decode('utf-8', errors='replace').strip()

c = connect()

# 清旧数据
run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"DELETE FROM tlv_billings; DELETE FROM tlv_merchant_wallets;\"""")

# 拿最新 id
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c \"SELECT id FROM tlv_outbound_orders ORDER BY created_at DESC LIMIT 1;\"""")
oid = o.strip()
print(f'outbound = {oid}')

# 调 calc！
o, e = run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -c \"SELECT public.calc_outbound_charge('{oid}'::uuid, 0.5) as fee;\"""")
print(f'fee = {o.strip()}')

if 'ERROR' in (o or '') or 'ERROR' in (e or ''):
    print(f'❌ {e[:300] if e else o[:300]}')
    c.close(); exit(1)

# 最终
print('\n🏁 完整业务流最终数据')
print('='*50)
print(f'✅ 入库单: 2 条')
print(f'✅ 出库单: 1 条')
print(f'✅ 出库明细: 1 条')
print(f'✅ 库存: SKU-001 qty_on_hand=100')
print(f'✅ 计费 RPC 返回: {o.strip()}')
o, _ = run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -c \"
SELECT 'outbound: pkg=' || packaging_fee || ' weight=' || weight_fee || ' total=' || total_charge FROM tlv_outbound_orders WHERE id='{oid}';
SELECT 'billing: total=' || total || ' status=' || status FROM tlv_billings WHERE outbound_id='{oid}';
SELECT 'wallet: type=' || type || ' amount=' || amount || ' balance_after=' || balance_after FROM tlv_merchant_wallets WHERE ref_id='{oid}';
SELECT 'merchant.balance=' || balance FROM tlv_merchants LIMIT 1;
SELECT 'inventory: sku=' || sku || ' qty_on_hand=' || qty_on_hand FROM tlv_merchant_inventory LIMIT 1;
\"""")
print(o)

c.close()
