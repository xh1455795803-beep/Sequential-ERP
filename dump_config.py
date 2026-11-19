#!/usr/bin/env python3
"""Dump postgrest config and test Authorization header"""
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

# 1. Dump postgrest config
print("=== 1. postgrest --dump-config ===")
# Create a temp config file with our env vars, then run postgrest --dump-config
# Actually we can just run postgrest --dump-config which reads from env
ec, out, err = ssh("docker exec supabase-rest postgrest --dump-config 2>&1 | grep -iE 'jwt|secret|auth|aud'")
print(f"JWT-related config:\n{out}")

# Full dump
print("\n=== 2. Full dump (first 100 lines) ===")
ec, out, err = ssh("docker exec supabase-rest postgrest --dump-config 2>&1 | head -100")
print(out)

# 3. Check: do wget in auth container send Authorization header?
print("\n=== 3. Test wget Authorization ===")
# Create a test endpoint: let's use postgrest itself
# Or use nc to check headers

# Actually use a simple approach: postgrest returns 401 if JWT is bad but it should still log it
# Let me check by sending a completely invalid JWT and see if anything changes

# Login
ec, out, _ = ssh('docker exec supabase-auth wget -qO- --post-data=\'{"email":"admin@thalvior.icu","password":"3403641888"}\' --header=\'Content-Type: application/json\' http://localhost:9999/token?grant_type=password')
auth_jwt = json.loads(out)['access_token']

# Test with VALID JWT (from auth)
print("\n=== 4. Tests ===")
tests = [
    ("VALID auth JWT", auth_jwt),
    ("TOTALLY FAKE JWT", "aaaa.bbbb.cccc"),
]

for label, jwt in tests:
    # via host curl -> envoy -> postgrest
    cmd = f"curl -sS -v --max-time 10 -H 'apikey: thalvior-test' -H 'Authorization: Bearer {jwt}' http://127.0.0.1:8000/rest/v1/rpc/debug_jwt_claims 2>&1 | tail -20"
    ec, out, err = ssh(cmd)
    print(f"\n[{label}] (via envoy)")
    print(out[:500])

# 5. Postgrest logs NOW
print("\n=== 5. Postgrest logs NOW ===")
ec, out, _ = ssh("docker logs supabase-rest --since 1m 2>&1")
print(out[-3000:])

# 6. Check if Authorization even arrives at postgrest
# Use nc on rest container? No nc...
# Let me try another approach: create a custom header and check if we see it in logs or response

# Actually postgrest might strip unknown headers or log them
# Let's check if we can get ANY response that indicates auth header was processed

# Try with a JWT that has role=service_role - maybe that works differently
print("\n=== 6. Try service_role JWT ===")
NEW_SECRET = "thalvior-wms-supabase-jwt-secret-v1-fixed-2026-wb-v2"
raw_key = NEW_SECRET.encode()

def b64u(d): return base64.urlsafe_b64encode(d).rstrip(b'=')
def sign_jwt(p, s):
    h = json.dumps({"alg": "HS256", "typ": "JWT"}).encode()
    pp = json.dumps(p).encode()
    si = b64u(h) + b'.' + b64u(pp)
    sig = hmac.new(s, si, hashlib.sha256).digest()
    return (si + b'.' + b64u(sig)).decode()

service_jwt = sign_jwt({"role": "service_role", "aud": "authenticated", "sub": "test"}, raw_key)
cmd = f'docker exec supabase-auth wget -qO- --header="Authorization: Bearer {service_jwt}" http://rest:3000/rpc/debug_jwt_claims'
ec, out, _ = ssh(cmd)
print(f"service_role JWT: {out[:500]}")

anon_jwt = sign_jwt({"role": "anon", "aud": "anon", "sub": "test"}, raw_key)
cmd = f'docker exec supabase-auth wget -qO- --header="Authorization: Bearer {anon_jwt}" http://rest:3000/rpc/debug_jwt_claims'
ec, out, _ = ssh(cmd)
print(f"anon JWT: {out[:500]}")

# 7. CRITICAL: what if postgrest db_uri uses authenticator but PGRST_DB_ANON_ROLE=anon?
# When JWT role claim = authenticated, postgrest does SET ROLE authenticated
# But authenticated role must exist in DB! Let's check
print("\n=== 7. Check DB roles ===")
ec, out, _ = ssh("""docker exec supabase-db psql -U supabase_admin -d postgres -c "SELECT rolname, rolsuper, rolcanlogin FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'authenticator', 'service_role') ORDER BY rolname;" """)
print(out)

client.close()
