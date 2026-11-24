import socket, struct, time, sys

# === SOCKS5 proxy via HTTP CONNECT ===
def http_connect(host, port, proxy_host='127.0.0.1', proxy_port=18080):
    s = socket.socket()
    s.connect((proxy_host, proxy_port))
    req = f"CONNECT {host}:{port} HTTP/1.1\r\nHost: {host}:{port}\r\n\r\n"
    s.sendall(req.encode())
    resp = b''
    while b'\r\n\r\n' not in resp:
        chunk = s.recv(4096)
        if not chunk: break
        resp += chunk
    if b'200' not in resp.split(b'\r\n')[0]:
        raise Exception(f"Proxy failed: {resp[:200]}")
    return s

sock = http_connect('43.133.232.81', 22)
time.sleep(0.8)

import paramiko
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('43.133.232.81', username='ubuntu', key_filename='/root/.ssh/id_rsa', sock=sock)

def q(sql):
    safe = sql.replace('"', '\\"').replace('$', '\\$')
    cmd = f'docker exec supabase-db psql -U supabase_admin -d postgres -x -c "{safe}"'
    stdin, stdout, stderr = ssh.exec_command(cmd)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    if err.strip():
        print(f"  [STDERR] {err.strip()}")
    return out

tables = [
    ("tlv_stock_takes", "SELECT id, warehouse_id, type, status, total_rows, matched_rows, diff_rows, adjusted_qty, started_at, completed_at, operator_name FROM tlv_stock_takes ORDER BY started_at DESC"),
    ("tlv_stock_take_items", "SELECT stock_take_id, row_no, merchant_id, sku, location, system_qty, counted_qty, diff_qty, adjusted FROM tlv_stock_take_items ORDER BY stock_take_id, row_no"),
    ("tlv_merchant_inventory", "SELECT merchant_id, sku, location, qty_on_hand, first_in_at FROM tlv_merchant_inventory ORDER BY merchant_id, sku"),
    ("tlv_inventory_logs", "SELECT warehouse_id, merchant_id, sku, location, change_type, qty_change, qty_before, qty_after, ref_no, ref_id FROM tlv_inventory_logs ORDER BY created_at DESC LIMIT 20"),
    ("tlv_merchant_wallets", "SELECT merchant_id, type, amount, balance_after, ref_no, created_at FROM tlv_merchant_wallets ORDER BY created_at DESC"),
]

for name, sql in tables:
    print(f"\n{'='*20} {name} {'='*20}")
    print(q(sql))

ssh.close()
