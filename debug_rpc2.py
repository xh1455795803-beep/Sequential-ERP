#!/usr/bin/env python3
"""直接查 billing_rules 匹配"""
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

queries = [
    ("最新 outbound 详情", """
SELECT id, warehouse_id, merchant_id, weight_kg, status
FROM tlv_outbound_orders ORDER BY created_at DESC LIMIT 3;
"""),
    ("billing_rules 匹配", """
SELECT id, warehouse_id, merchant_id, rule_type, rate, status
FROM tlv_billing_rules 
WHERE warehouse_id = (SELECT warehouse_id FROM tlv_outbound_orders ORDER BY created_at DESC LIMIT 1);
"""),
    ("直接 SELECT billing 模拟 RPC", """
SELECT COALESCE(rate, 0) as pkg_rate FROM tlv_billing_rules
WHERE warehouse_id = (SELECT warehouse_id FROM tlv_outbound_orders ORDER BY created_at DESC LIMIT 1)
  AND (merchant_id = (SELECT merchant_id FROM tlv_outbound_orders ORDER BY created_at DESC LIMIT 1) OR merchant_id IS NULL)
  AND rule_type = 'packaging' AND status = 'active'
ORDER BY merchant_id NULLS LAST, priority ASC LIMIT 1;
"""),
    ("直接 SQL 调 calc", """
DO $$
DECLARE
  oid uuid;
  fee numeric;
BEGIN
  SELECT id INTO oid FROM tlv_outbound_orders ORDER BY created_at DESC LIMIT 1;
  RAISE NOTICE 'outbound: %', oid;
  BEGIN
    fee := public.calc_outbound_charge(oid, 0.5);
    RAISE NOTICE 'fee: %', fee;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'ERROR: % %', SQLSTATE, SQLERRM;
  END;
END $$;
"""),
]

for name, q in queries:
    print(f'\n📋 {name}:')
    o, e = run(c, f"""docker exec supabase-db psql -U supabase_admin -d postgres -c \"{q}\" 2>&1""")
    print(f'  {o.strip()}')
    if e: print(f'  err: {e.strip()[:200]}')

c.close()
