#!/usr/bin/env python3
"""Restart envoy and test after JWT fix"""
import socket, base64, hmac, hashlib, paramiko, time, sys, json

s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.connect(('127.0.0.1', 18080))
s.sendall(b"CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n")
resp = b''
while b'\r\n\r\n' not in resp:
    resp += s.recv(4096)

t = paramiko.Transport(s)
t.start_client()
t.auth_password('ubuntu', 'Yuan340364#')

def ssh(cmd):
    c = t.open_session(); c.exec_command(cmd)
    out, err = b'', b''
    while True:
        ch = c.recv(65536)
        if not ch: break
        out += ch
    ec = c.recv_exit_status()
    return ec, out.decode('utf-8', errors='replace'), err.decode('utf-8', errors='replace')

def sudo(cmd):
    return ssh(f"sudo {cmd}")

# Regenerate keys for this session
original_b64 = "BRnoce2N0ZWRx+NZBWYEWnTlHVBI5jiE9DTyH/jie9A="
raw_key = base64.b64decode(original_b64)
def b64url_encode(d): return base64.urlsafe_b64encode(d).rstrip(b'=')
def sign_jwt(p, s):
    h = json.dumps({"alg": "HS256", "typ": "JWT"}).encode()
    pp = json.dumps(p).encode()
    si = b64url_encode(h) + b'.' + b64url_encode(pp)
    sig = hmac.new(s, si, hashlib.sha256).digest()
    return (si + b'.' + b64url_encode(sig)).decode()

new_anon = sign_jwt({"role": "anon", "iss": "supabase", "iat": 1790268016, "exp": 2105628016}, raw_key)

# 1. Restart envoy
print("=== Restart envoy ===")
ec, out, _ = sudo("cd /opt/supabase/docker && docker compose up -d api-gw 2>&1")
print(out)
time.sleep(5)

# 2. Also restart auth and rest to be sure (they already use new .env)
print("\n=== Restart auth + rest ===")
ec, out, _ = sudo("cd /opt/supabase/docker && docker compose up -d auth rest 2>&1")
print(out)
time.sleep(5)

# Wait for health
for i in range(15):
    time.sleep(3)
    ec, out, _ = ssh("docker ps --format '{{.Names}} {{.Status}}' | grep -E 'supabase-(auth|rest|envoy)'")
    lines = [l for l in out.strip().split('\n') if l.strip()]
    print(f"  [{i*3}s] {lines}")
    if all(('healthy' in l or 'Up' in l) for l in lines) and len(lines) >= 3:
        print("  All up!")
        break

# 3. Verify envoy has new ANON_KEY
print("\n=== Verify envoy has new ANON_KEY ===")
ec, out, _ = ssh(f"docker inspect supabase-envoy --format '{{{{range .Config.Env}}{{println .}}{{end}}' | grep ANON_KEY")
print(f"Envoy ANON_KEY env: {out.strip()[:80]}...")

# Also check generated lds.yaml
ec, out, _ = sudo("grep 'local ANON_KEY' /opt/supabase/docker/volumes/api/envoy/lds.yaml | head -1")
print(f"lds.yaml ANON_KEY: {out.strip()[:80]}...")

# 4. Login fresh
print("\n=== Login fresh ===")
ec, out, _ = ssh('docker exec supabase-auth wget -qO- --post-data=\'{"email":"admin@thalvior.icu","password":"3403641888"}\' --header=\'Content-Type: application/json\' http://localhost:9999/token?grant_type=password')
login_data = json.loads(out)
auth_jwt = login_data['access_token']
print(f"Auth JWT: {auth_jwt[:60]}...")

# 5. Test envoy -> postgrest
print("\n=== Test envoy + apikey + auth jwt ===")

# Test 1: debug_jwt_claims
cmd = f'curl -sS --connect-timeout 5 --max-time 15 -H "apikey: {new_anon}" -H "Authorization: Bearer {auth_jwt}" http://127.0.0.1:8000/rest/v1/rpc/debug_jwt_claims'
ec, out, err = ssh(cmd)
print(f"[debug] ec={ec}: {out[:500]}")

# Test 2: wms_orders
cmd = f'curl -sS --connect-timeout 5 --max-time 15 -H "apikey: {new_anon}" -H "Authorization: Bearer {auth_jwt}" "http://127.0.0.1:8000/rest/v1/wms_orders?select=order_id,order_no,status,tenant_id"'
ec, out, err = ssh(cmd)
print(f"[orders] ec={ec}: {out[:500]}")

# Test 3: wms_warehouses
cmd = f'curl -sS --connect-timeout 5 --max-time 15 -H "apikey: {new_anon}" -H "Authorization: Bearer {auth_jwt}" "http://127.0.0.1:8000/rest/v1/wms_warehouses?select=warehouse_id,warehouse_code,warehouse_name"'
ec, out, err = ssh(cmd)
print(f"[warehouses] ec={ec}: {out[:300]}")

# Test 4: wms_shipping_channels
cmd = f'curl -sS --connect-timeout 5 --max-time 15 -H "apikey: {new_anon}" -H "Authorization: Bearer {auth_jwt}" "http://127.0.0.1:8000/rest/v1/wms_shipping_channels?select=channel_id,channel_code,channel_name,is_active"'
ec, out, err = ssh(cmd)
print(f"[channels] ec={ec}: {out[:300]}")

# Test 5: wms_inbound_receipts (ASN)
cmd = f'curl -sS --connect-timeout 5 --max-time 15 -H "apikey: {new_anon}" -H "Authorization: Bearer {auth_jwt}" "http://127.0.0.1:8000/rest/v1/wms_inbound_receipts?select=receipt_id,receipt_no,status"'
ec, out, err = ssh(cmd)
print(f"[asn] ec={ec}: {out[:300]}")

# 6. Also verify postgrest container has correct JWT_SECRET
print("\n=== Verify postgrest env ===")
ec, out, _ = ssh("docker inspect supabase-rest --format '{{range .Config.Env}}{{println .}}{{end}}' | grep PGRST_JWT")
print(out)

# 7. Verify auth container has correct JWT_SECRET  
print("\n=== Verify auth env ===")
ec, out, _ = ssh("docker inspect supabase-auth --format '{{range .Config.Env}}{{println .}}{{end}}' | grep GOTRUE_JWT")
print(out)

t.close()
print("\n=== DONE ===")
