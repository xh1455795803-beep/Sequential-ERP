#!/usr/bin/env python3
"""硬重启node进程（systemctl需要sudo权限）"""
import paramiko, os, sys
SSH_HOST = '120.55.6.75'
SSH_USER = 'admin'
SSH_PASS = 'yuan340364'

proxy = os.environ.get('HTTPS_PROXY') or os.environ.get('ALL_PROXY') or ''

def connect():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    sock = None
    if proxy:
        try:
            from paramiko.proxy import ProxyCommand
            import urllib.parse
            p = urllib.parse.urlparse(proxy)
            hostport = f"{p.hostname}:{p.port or 8080}"
            cmd = f"nc -X connect -x {hostport} {SSH_HOST} 22"
            sock = ProxyCommand(cmd)
        except Exception as e:
            print(f"[warn] proxy setup fail: {e}")
    client.connect(SSH_HOST, 22, SSH_USER, SSH_PASS, sock=sock, timeout=30)
    return client

def run(c, cmd):
    print(f"$ {cmd.splitlines()[0]}")
    stdin, stdout, stderr = c.exec_command(cmd, timeout=60)
    out = stdout.read().decode('utf-8', errors='ignore')
    err = stderr.read().decode('utf-8', errors='ignore')
    if out: print(out[:2000])
    if err: print("[stderr]", err[:1000])
    return out + err

c = connect()
print("[1] kill existing node process")
run(c, "pkill -f 'node src/app.js' 2>/dev/null; sleep 1; echo killed")

print("\n[2] start backend in background")
run(c, "cd /opt/shuxu-erp/backend && (nohup /opt/node20/bin/node src/app.js > /tmp/erp.log 2>&1 &) && sleep 3 && echo started")

print("\n[3] check process")
out = run(c, "ps aux | grep 'node src/app.js' | grep -v grep; sleep 1; ss -tlnp 2>/dev/null | grep 8090 || netstat -tlnp 2>/dev/null | grep 8090")
if '8090' in out: print("✓ backend up on 8090")
else: print("⚠ unclear, see above")

print("\n[4] API smoke test")
tests = [
    "/api/v1/public/landing/config",
    "/api/v1/stats/dashboard (needs auth - 401 ok)",
]
run(c, "curl -s -o /dev/null -w 'HTTP %{http_code}\\n' http://127.0.0.1:8090/api/v1/public/landing/config")
run(c, "curl -s -o /dev/null -w 'HTTP %{http_code} (unauth expected)\\n' http://127.0.0.1:8090/api/v1/stats/dashboard")
run(c, "curl -sk -o /dev/null -w 'HTTPS /app/ HTTP %{http_code}\\n' https://qianniu-erp.cc/app/")
run(c, "curl -sk -o /dev/null -w 'HTTPS / HTTP %{http_code}\\n' https://qianniu-erp.cc/")

print("\n[5] billing owner middleware check (no token → 401 not 403)")
out = run(c, "curl -s -o /dev/null -w 'HTTP %{http_code}\\n' http://127.0.0.1:8090/api/v1/billing/overview")
print(f"billing/overview noauth: {out.strip()}")

c.close()
print("\n✓ restart complete")
