#!/usr/bin/env python3
"""Fix wms_accounts.user_id + auth API test + nginx default server."""
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

# 1. Link wms_accounts.user_id to auth.users
print("=== 1. Link wms_accounts.user_id ===")
o, e = run("""docker exec supabase-db psql -U supabase_admin -d postgres -c "
UPDATE wms_accounts a
SET user_id = u.id
FROM auth.users u
WHERE a.email = u.email AND a.user_id IS NULL;
SELECT * FROM wms_accounts;" """)
print(o)

# 2. Test auth API properly
print("\n=== 2. Auth API test ===")
o, _ = run("grep '^ANON_KEY=' /opt/supabase/docker/.env | cut -d= -f2")
ANON = o.strip()
o, e = run(f"""curl -sS -X POST 'http://localhost:8000/auth/v1/token?grant_type=password' \
  -H 'apikey: {ANON}' \
  -H 'Content-Type: application/json' \
  -d '{{"email":"admin@thalvior.icu","password":"3403641888"}}' 2>&1""")
print(f"Auth sign-in: {o[:500]}")

# 3. Make nginx config also catch IP access (default_server)
print("\n=== 3. nginx default_server + API proxy paths ===")
nginx = """server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name wms.thalvior.icu _;

    root /var/www/wms;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /rest/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host 127.0.0.1:8000;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location /auth/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host 127.0.0.1:8000;
        proxy_set_header X-Real-IP $remote_addr;
    }
    location /storage/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host 127.0.0.1:8000;
        proxy_set_header X-Real-IP $remote_addr;
    }
    location /functions/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host 127.0.0.1:8000;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
"""
import base64
b64 = base64.b64encode(nginx.encode()).decode()
run(f"echo '{b64}' | base64 -d | sudo tee /etc/nginx/sites-available/wms > /dev/null")
o, e = run("sudo nginx -t 2>&1; sudo nginx -s reload 2>&1 | head -3")
print(f"nginx: {o} {e}")

# 4. Quick verify IP access
print("\n=== 4. IP direct access test ===")
import urllib.request
def test(url, headers=None):
    try:
        req = urllib.request.Request(url, headers=headers or {})
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status, resp.read()[:300].decode(errors='replace')
    except urllib.error.HTTPError as ex:
        return f"HTTP {ex.code}", ex.read()[:300].decode(errors='replace')
    except Exception as ex:
        return f"ERR: {ex}", ""

s, b = test("http://43.133.232.81/")
print(f"  IP Frontend: {s}")
if b and '<div id="root">' in b: print("    ✅ React app loads")

s, b = test(f"http://43.133.232.81/rest/v1/wms_orders?limit=3", {"apikey": ANON})
print(f"  IP API: {s} → {b[:200]}")
