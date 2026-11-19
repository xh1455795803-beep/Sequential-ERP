#!/usr/bin/env python3
"""Check DNS + auth users, then browser test."""
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

# 1. Check DNS resolution
print("=== 1. DNS ===")
o, e = run("nslookup wms.thalvior.icu 2>/dev/null || host wms.thalvior.icu 2>/dev/null || echo 'no dns tool'")
print(o)

# 2. Check auth.users table
print("\n=== 2. auth.users ===")
o, e = run("""docker exec supabase-db psql -U supabase_admin -d postgres -c "
SELECT id, email, email_confirmed_at, created_at FROM auth.users;" """)
print(o)

# 3. If no users, check seed data or create admin
print("\n=== 3. wms_accounts → auth.users mapping ===")
o, e = run("""docker exec supabase-db psql -U supabase_admin -d postgres -c "
SELECT a.id as account_id, a.email, a.user_id, u.id as auth_user_id, u.email as auth_email
FROM wms_accounts a
LEFT JOIN auth.users u ON a.user_id = u.id;" """)
print(o)

# 4. Test auth API (sign in should work)
print("\n=== 4. Auth API ===")
o, e = run("""curl -sS -X POST 'http://localhost:8000/auth/v1/token?grant_type=password' \
  -H 'apikey: $(grep '^ANON_KEY=' /opt/supabase/docker/.env | cut -d= -f2)' \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@thalvior.icu","password":"3403641888"}' 2>&1 | head -c 500""")
print(o)

# 5. Also add default server catch-all for nginx
print("\n=== 5. Make wms the default server ===")
# Change listen 80 to listen 80 default_server
import subprocess, base64, os
result = subprocess.run(["sshpass", "-p", "Yuan340364#", "ssh", "-o", "ProxyCommand=nc -X connect -x 127.0.0.1:18080 %h %p", "-o", "StrictHostKeyChecking=no", "ubuntu@43.133.232.81", 
    "sudo sed -i 's/listen 80;/listen 80 default_server;/' /etc/nginx/sites-available/wms && sudo sed -i 's/listen \\[::\\]:80;/listen [::]:80 default_server;/' /etc/nginx/sites-available/wms && sudo nginx -t 2>&1 && sudo nginx -s reload"],
    capture_output=True, text=True, timeout=30)
print(result.stdout[:500])
print(result.stderr[:500])

# Actually let's do it via python paramiko
run("sudo sed -i 's/listen 80;/listen 80 default_server;/' /etc/nginx/sites-available/wms")
run("sudo sed -i 's/listen \\[::\\]:80;/listen [::]:80 default_server;/' /etc/nginx/sites-available/wms")
o, e = run("sudo nginx -t 2>&1 | head -5; sudo nginx -s reload 2>&1 | head -5")
print(f"nginx: {o} {e}")
