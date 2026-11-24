#!/usr/bin/env python3
"""RPC 终极修复 v3 — type=consume"""
import socket, time, paramiko
HOST, PORT, USER, PASS = '43.133.232.81', 22, 'ubuntu', 'yuan340364#'
def connect():
    sock = socket.socket(); sock.settimeout(20); sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, socket.SO_REUSEADDR, 1)
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

# 最简单的修法：直接 sed 替换 SQL 字符串里的 'balance' → 'consume'
rpc_text = open('/tmp/rpc_final.sql').read().replace("'balance'", "'consume'")
rpc_text = rpc_text.replace('v_merchant, v_wh, \'consume\'', 'v_merchant, v_wh, \'consume\'')  # already correct

c = connect()
sftp = c.open_sftp()
with open('/tmp/rpc_v3.sql', 'w') as f:
    f.write(rpc_text)
sftp.put('/tmp/rpc_v3.sql', '/tmp/rpc_v3.sql')
sftp.close()
o, e = run(c, """docker cp /tmp/rpc_v3.sql supabase-db:/tmp/rpc_v3.sql && docker exec supabase-db psql -U supabase_admin -d postgres -f /tmp/rpc_v3.sql""")
print(f'CREATE: {o.strip() or e.strip()[:200]}')

# 拿最新 outbound + 清旧账单
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c \"SELECT id FROM tlv_outbound_orders ORDER BY created_at DESC LIMIT 1;\"""")
oid = o.strip()
run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -c \"DELETE FROM tlv_billings WHERE outbound_id='{oid}'; DELETE FROM tlv_merchant_wallets WHERE ref_id='{oid}';\"""")

# 调！
o, e = run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -c \"SELECT public.calc_outbound_charge('{oid}'::uuid, 0.5) as fee;\"""")
print(f'fee = {o.strip()}')
if 'ERROR' in (o or '') or 'ERROR' in (e or ''):
    print(f'  ❌ {e[:200] if e else o[:200]}')
    c.close(); exit(1)

# 最终
print('\n🏁 最终数据:')
o, _ = run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -c \"
SELECT pkg_rate + (weight_rate * 0.5) as expected FROM (
  SELECT 
    (SELECT rate FROM tlv_billing_rules WHERE warehouse_id=(SELECT warehouse_id FROM tlv_outbound_orders WHERE id='{oid}') AND rule_type='packaging' AND status='active' LIMIT 1) as pkg_rate,
    (SELECT rate FROM tlv_billing_rules WHERE warehouse_id=(SELECT warehouse_id FROM tlv_outbound_orders WHERE id='{oid}') AND rule_type='weight' AND status='active' LIMIT 1) as weight_rate
) x;
SELECT 'outbound total=' || total_charge || ' pkg=' || packaging_fee || ' weight=' || weight_fee FROM tlv_outbound_orders WHERE id='{oid}';
SELECT 'billing total=' || total || ' items=' || items FROM tlv_billings WHERE outbound_id='{oid}';
SELECT 'wallet type=' || type || ' amount=' || amount || ' after=' || balance_after FROM tlv_merchant_wallets WHERE ref_id='{oid}';
SELECT 'merchant balance=' || balance FROM tlv_merchants LIMIT 1;
\"""")
print(o)
c.close()
