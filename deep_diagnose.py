#!/usr/bin/env python3
"""Deep diagnose postgrest JWT handling"""
import socket, base64, hmac, hashlib, paramiko, time, sys, json

s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.connect(('127.0.0.1', 18080))
s.sendall(b"CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n")
resp = b''
while b'\r\n\r\n' not in resp:
    resp += s.recv(4096)

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('43.133.232.81', port=22, username='ubuntu', password='Yuan340364#', sock=s)

def ssh(cmd):
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    ec = stdout.channel.recv_exit_status()
    return ec, out, err

def sudo(cmd):
    return ssh(f"sudo {cmd}")

NEW_SECRET = "thalvior-wms-supabase-jwt-secret-v1-fixed-2026-wb-v2"
raw_key = NEW_SECRET.encode()

# Login
print("=== Login ===")
ec, out, _ = ssh('docker exec supabase-auth wget -qO- --post-data=\'{"email":"admin@thalvior.icu","password":"3403641888"}\' --header=\'Content-Type: application/json\' http://localhost:9999/token?grant_type=password')
login_data = json.loads(out)
auth_jwt = login_data['access_token']
parts = auth_jwt.split('.')
def b64ud(s):
    s += '=' * (4 - len(s) % 4)
    return base64.urlsafe_b64decode(s)
header = json.loads(b64ud(parts[0]))
payload = json.loads(b64ud(parts[1]))
sig = b64ud(parts[2])
print(f"JWT header: {header}")
print(f"JWT payload role: {payload.get('role')}")
print(f"JWT payload aud: {payload.get('aud')}")
print(f"JWT payload iss: {payload.get('iss')}")

# 1. Try direct connection: docker exec auth -> wget rest:3000 with Authorization only
print("\n=== 1. Direct rest:3000 with Authorization only ===")
# Auth container has wget, let's use it
cmd = f'docker exec supabase-auth wget -qO- --header="Authorization: Bearer {auth_jwt}" http://rest:3000/rpc/debug_jwt_claims'
ec, out, err = ssh(cmd)
print(f"ec={ec}: {out[:500]}")

# 2. Check postgrest for aud claim validation
print("\n=== 2. PGRST_JWT_AUD env? ===")
ec, out, _ = ssh("docker inspect supabase-rest --format '{{range .Config.Env}}{{println .}}{{end}}' | sort")
print(out)

# 3. Postgrest --help for JWT options
print("\n=== 3. Postgrest help JWT ===")
ec, out, _ = ssh("docker exec supabase-rest postgrest --help 2>&1 | grep -i jwt")
print(out)

# 4. What if we SET ROLE manually? Check wms_orders
print("\n=== 4. psql: what do we see with SET ROLE authenticated? ===")
ec, out, _ = ssh("""docker exec supabase-db psql -U supabase_admin -d postgres -c "SET ROLE authenticated; SELECT current_user, current_setting('request.jwt.claim.role', true), current_setting('request.jwt.claim.email', true);" """)
print(out)

# 5. What if we set session settings manually via psql?
print("\n=== 5. psql SET ROLE + set_config ===")
ec, out, _ = ssh("""docker exec supabase-db psql -U supabase_admin -d postgres -c "
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.email', 'admin@thalvior.icu', true);
SELECT set_config('request.jwt.claim.sub', '6f9fc265-7ed8-48a3-a1b1-cdc18f310bae', true);
SELECT * FROM wms_orders LIMIT 5;
" """)
print(out[:500])

# 6. Check postgrest logs for JWT errors
print("\n=== 6. Postgrest logs ===")
ec, out, _ = ssh("docker logs supabase-rest --since 2m 2>&1")
print(out[-2000:])

# 7. Try modifying the JWT payload: remove aud or match postgrest expectation
print("\n=== 7. Try JWT with role=authenticated, no aud ===")

def b64u(d): return base64.urlsafe_b64encode(d).rstrip(b'=')
def sign_jwt(p, s):
    h = json.dumps({"alg": "HS256", "typ": "JWT"}).encode()
    pp = json.dumps(p).encode()
    si = b64u(h) + b'.' + b64u(pp)
    sig = hmac.new(s, si, hashlib.sha256).digest()
    return (si + b'.' + b64u(sig)).decode()

# Test JWT with aud=authenticated (auth uses this, gotrue sets it)
test_payloads = [
    ("with aud=authenticated", {
        "role": "authenticated", "email": "admin@thalvior.icu",
        "sub": "6f9fc265-7ed8-48a3-a1b1-cdc18f310bae", "aud": "authenticated",
        "exp": 1999999999, "iat": 1795000000, "iss": "https://thalvior.icu"
    }),
    ("without aud", {
        "role": "authenticated", "email": "admin@thalvior.icu",
        "sub": "6f9fc265-7ed8-48a3-a1b1-cdc18f310bae",
        "exp": 1999999999, "iat": 1795000000
    }),
    ("role=anon", {
        "role": "anon", "email": "admin@thalvior.icu",
        "sub": "6f9fc265-7ed8-48a3-a1b1-cdc18f310bae", "aud": "anon",
        "exp": 1999999999, "iat": 1795000000
    }),
    ("matching auth exactly", payload),
]

for label, p in test_payloads:
    jwt = sign_jwt(p, raw_key)
    # test via direct postgrest
    cmd = f'docker exec supabase-auth wget -qO- --header="Authorization: Bearer {jwt}" http://rest:3000/rpc/debug_jwt_claims'
    ec, out, _ = ssh(cmd)
    result = json.loads(out) if out else {}
    print(f"  [{label}] cur_user={result.get('cur_user')} role={result.get('role_claim')} email={result.get('email_claim')} sub={result.get('sub_claim')}")

client.close()
