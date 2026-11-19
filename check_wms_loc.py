#!/usr/bin/env python3
"""Check thalvior.fun /wms/ location + use it."""
import socket, paramiko, time

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

# 1. Show EXACTLY the /wms/ location block
print("=== 1. /wms/ location in thalvior.fun ===")
o, e = run("""awk '/location.*\\/wms/,/^    }/{print NR": "$0}' /etc/nginx/sites-available/thalvior.fun""")
print(o)

# 2. Remove our 8080 site (was causing 502)
print("\n=== 2. Clean up + restart ===")
run("sudo rm -f /etc/nginx/sites-enabled/wms")
o, e = run("sudo nginx -t 2>&1; sudo nginx -s reload 2>&1 | head -3")
print(f"nginx: {o} {e}")

# 3. Test thalvior.fun/wms/
print("\n=== 3. Test thalvior.fun /wms/ ===")
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

o, _ = run("grep '^ANON_KEY=' /opt/supabase/docker/.env | cut -d= -f2")
ANON = o.strip()

s, b = test("http://thalvior.fun/wms/")
print(f"  thalvior.fun/wms/: {s}")

# Also test rest API via thalvior.fun
s, b = test(f"http://thalvior.fun/rest/v1/wms_orders?limit=3", {"apikey": ANON})
print(f"  thalvior.fun/rest/v1/: {s} → {b[:200]}")

# And direct IP access for API
s, b = test(f"http://43.133.232.81:8000/rest/v1/wms_orders?limit=3", {"apikey": ANON})
print(f"  Direct :8000 API: {s} → {b[:200]}")
