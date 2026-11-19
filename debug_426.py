#!/usr/bin/env python3
"""Debug 426 Upgrade Required — envoy vs nginx proxy."""
import socket, paramiko, time, json

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

o, _ = run("grep '^ANON_KEY=' /opt/supabase/docker/.env | cut -d= -f2")
ANON = o.strip()

# 1. Direct envoy with various Host headers
print("=== 1. Direct envoy with different Host headers ===")
o, e = run(f"""echo '-- default Host --'
curl -sv 'http://localhost:8000/rest/v1/' -H 'apikey: {ANON}' 2>&1 | grep -E '> Host|< HTTP|< server|< content'
echo ''
echo '-- Host: wms.thalvior.icu --'
curl -sv 'http://localhost:8000/rest/v1/' -H 'apikey: {ANON}' -H 'Host: wms.thalvior.icu' 2>&1 | grep -E '> Host|< HTTP|< server|< content'
echo ''
echo '-- Host: localhost:8000 --'
curl -sv 'http://localhost:8000/rest/v1/' -H 'apikey: {ANON}' -H 'Host: localhost:8000' 2>&1 | grep -E '> Host|< HTTP|< server|< content'""")
print(o)

# 2. Show envoy config
print("\n=== 2. Envoy config ===")
o, e = run("docker exec supabase-envoy cat /etc/envoy/envoy.yaml 2>/dev/null | head -80")
print(o)

# 3. Envoy Lua filter
print("\n=== 3. Envoy lua filter ===")
o, e = run("docker exec supabase-envoy find / -name '*.lua' 2>/dev/null; echo '---'; docker exec supabase-envoy ls /etc/envoy/ 2>/dev/null")
print(o)
for lua_path in o.split('\n'):
    if lua_path.endswith('.lua'):
        content, _ = run(f"docker exec supabase-envoy cat {lua_path} 2>/dev/null")
        print(f"\n--- {lua_path} ---")
        print(content[:2000])

# 4. Try proxy_set_header Host 127.0.0.1:8000
print("\n=== 4. Fix nginx proxy_set_header Host ===")
nginx_conf = """server {
    listen 80;
    listen [::]:80;
    server_name wms.thalvior.icu;

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
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
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
b64 = base64.b64encode(nginx_conf.encode()).decode()
run(f"echo '{b64}' | base64 -d | sudo tee /etc/nginx/sites-available/wms > /dev/null")
o, e = run("sudo nginx -t 2>&1; sudo nginx -s reload 2>&1; sleep 1")
print(f"nginx: {o} {e}")

# 5. Test again
print("\n=== 5. Test after fix ===")
o, e = run(f"""echo '-- via nginx --'
curl -sv -H 'Host: wms.thalvior.icu' 'http://localhost/rest/v1/wms_orders?limit=5' -H 'apikey: {ANON}' 2>&1 | grep -E '< HTTP|< content|^\\[' | head -10""")
print(o)
