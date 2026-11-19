#!/usr/bin/env python3
"""Diagnose JWT secret handling"""
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

# Login to get auth's JWT
ec, out, _ = ssh('docker exec supabase-auth wget -qO- --post-data=\'{"email":"admin@thalvior.icu","password":"3403641888"}\' --header=\'Content-Type: application/json\' http://localhost:9999/token?grant_type=password')
login_data = json.loads(out)
auth_jwt = login_data['access_token']

# Decode
parts = auth_jwt.split('.')
def b64u(s):
    s += '=' * (4 - len(s) % 4)
    return base64.urlsafe_b64decode(s)

header = json.loads(b64u(parts[0]))
payload = json.loads(b64u(parts[1]))
sig_actual = b64u(parts[2])
sig_input = (parts[0] + '.' + parts[1]).encode()

print(f"Auth JWT header: {header}")
print(f"Auth JWT payload role: {payload.get('role')}")

# Now try signing with different interpretations of JWT_SECRET
jwt_secret_b64_str = "BRnoce2N0ZWRx+NZBWYEWnTlHVBI5jiE9DTyH/jie9A="

keys_to_test = [
    ("raw_string (44 bytes as-is)", jwt_secret_b64_str.encode()),
    ("b64_decode first (32 bytes)", base64.b64decode(jwt_secret_b64_str)),
]

for label, key_bytes in keys_to_test:
    expected = hmac.new(key_bytes, sig_input, hashlib.sha256).digest()
    match = hmac.compare_digest(sig_actual, expected)
    print(f"\nSigning auth's JWT with [{label}] (len={len(key_bytes)}):")
    print(f"  Match: {match}")
    if match:
        print(f"  >>> AUTH uses [{label}] to sign!")

# So now we know AUTH uses which format.
# Let's say it uses FORMAT_X. Now sign a JWT with FORMAT_X secret
# and see if postgrest accepts it.

print("\n\n=== Now let's sign OUR OWN JWT with each format and test postgrest ===")

def b64url_encode(d): return base64.urlsafe_b64encode(d).rstrip(b'=')
def sign_jwt(payload, secret_bytes):
    h = json.dumps({"alg": "HS256", "typ": "JWT"}).encode()
    p = json.dumps(payload).encode()
    si = b64url_encode(h) + b'.' + b64url_encode(p)
    sig = hmac.new(secret_bytes, si, hashlib.sha256).digest()
    return (si + b'.' + b64url_encode(sig)).decode()

# Postgrest might use raw string OR base64 decoded
# Let's test both

test_payload = {
    "role": "authenticated",
    "email": "admin@thalvior.icu",
    "sub": "6f9fc265-7ed8-48a3-a1b1-cdc18f310bae",
    "aud": "authenticated",
    "iss": "https://thalvior.icu",
    "exp": 1999999999,
    "iat": 1795000000,
}

for label, key_bytes in keys_to_test:
    jwt = sign_jwt(test_payload, key_bytes)
    cmd = f'curl -sS --connect-timeout 5 --max-time 15 -H "apikey: test" -H "Authorization: Bearer {jwt}" http://127.0.0.1:8000/rest/v1/rpc/debug_jwt_claims'
    ec, out, err = ssh(cmd)
    print(f"\n[postgrest with JWT signed by {label}]")
    print(f"  Result: {out[:500]}")

# Also: what if postgrest doesn't verify signature at all but our JWT payload just needs correct role claim?
print("\n\n=== Test without signature check idea: manually check what PGRST_JWT_SECRET gets used as ===")
# Let's check postgrest logs
ec, out, _ = ssh("docker logs supabase-rest --tail 50 2>&1")
print(f"Postgrest logs:\n{out[-2000:]}")

t.close()
