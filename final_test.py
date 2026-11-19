#!/usr/bin/env python3
"""FINAL: Full end-to-end test."""
import socket, paramiko, time, json, base64, hmac, hashlib

def ssh_exec(cmd, timeout=120, retries=3):
    last_err = None
    for _ in range(retries):
        try:
            s = socket.socket(); s.settimeout(15)
            s.connect(('127.0.0.1', 18080))
            s.sendall(b"CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n")
            t = paramiko.Transport(s); t.start_client(timeout=15); t.auth_password('ubuntu', 'Yuan340364#')
            chan = t.open_session(); chan.settimeout(timeout); chan.exec_command(cmd)
            out = chan.recv(131072).decode(errors='replace')
            err = chan.recv_stderr(65535).decode(errors='replace')
            t.close(); s.close()
            return out.strip(), err.strip()
        except Exception as ex:
            last_err = ex; time.sleep(2)
    raise last_err

def run(c, t=120): return ssh_exec(c, t)

o, _ = run("grep -E '^(JWT_SECRET|ANON_KEY)=' /opt/supabase/docker/.env")
env = {}
for line in o.split('\n'):
    if '=' in line:
        k, v = line.split('=', 1); env[k] = v.strip()
SECRET, ANON = env['JWT_SECRET'], env['ANON_KEY']

def make_jwt(sub, email, role):
    h = base64.urlsafe_b64encode(json.dumps({"alg":"HS256","typ":"JWT"}).encode()).rstrip(b'=').decode()
    p = json.dumps({"sub":sub,"email":email,"role":role,"aud":"authenticated","exp":int(time.time())+21600}).encode()
    pb = base64.urlsafe_b64encode(p).rstrip(b'=').decode()
    sig = hmac.new(SECRET.encode(), f"{h}.{pb}".encode(), hashlib.sha256).digest()
    sb = base64.urlsafe_b64encode(sig).rstrip(b'=').decode()
    return f"{h}.{pb}.{sb}"

auth_jwt = make_jwt("d0000000-0000-0000-0000-000000000001", "admin@thalvior.icu", "authenticated")

# 1. Direct envoy test
print("=== 1. Direct envoy :8000 (baseline) ===")
o, e = run(f"""echo '-- anon --'
curl -sS 'http://localhost:8000/rest/v1/wms_orders?limit=5' -H 'apikey: {ANON}' 2>&1 | head -c 300
echo ''
echo '-- authenticated --'
curl -sS 'http://localhost:8000/rest/v1/wms_orders?limit=5' -H 'apikey: {ANON}' -H 'Authorization: Bearer {auth_jwt}' 2>&1 | head -c 500""")
print(o)

# 2. Nginx proxy test
print("\n=== 2. Nginx proxy (Host: wms.thalvior.icu) ===")
o, e = run(f"""echo '-- anon via nginx --'
curl -sS -H 'Host: wms.thalvior.icu' 'http://localhost/rest/v1/wms_orders?limit=5' -H 'apikey: {ANON}' 2>&1 | head -c 300
echo ''
echo '-- authenticated via nginx --'
curl -sS -H 'Host: wms.thalvior.icu' 'http://localhost/rest/v1/wms_orders?limit=5' -H 'apikey: {ANON}' -H 'Authorization: Bearer {auth_jwt}' 2>&1 | head -c 500
echo ''
echo '-- debug full response --'
curl -sv -H 'Host: wms.thalvior.icu' 'http://localhost/rest/v1/' -H 'apikey: {ANON}' 2>&1 | head -40""")
print(o)

# 3. External connectivity via proxy
print("\n=== 3. External connectivity ===")
import urllib.request
def test_url(url, headers=None):
    try:
        req = urllib.request.Request(url, headers=headers or {})
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status, resp.read()[:500]
    except urllib.error.HTTPError as ex:
        return f"HTTP {ex.code}", ex.read()[:500]
    except Exception as ex:
        return f"ERR: {ex}", b""

status, body = test_url("http://43.133.232.81/", {"Host": "wms.thalvior.icu"})
print(f"  Frontend: {status}")
if body: print(f"    {body.decode(errors='replace')[:200]}")

status, body = test_url(f"http://43.133.232.81/rest/v1/wms_orders?limit=3", 
                        {"Host": "wms.thalvior.icu", "apikey": ANON})
print(f"  API (anon): {status}")
if body: print(f"    {body.decode(errors='replace')[:300]}")
