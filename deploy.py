#!/usr/bin/env python3
"""P2: Update frontend .env.production ANON_KEY + build + deploy."""
import socket, paramiko, time, json, os, subprocess

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

# ============================================================
# 1. Get current SUPABASE_URL and ANON_KEY from server .env
# ============================================================
print("=" * 70)
print("1. Read server .env values")
print("=" * 70)
o, _ = run("grep -E '^(ANON_KEY|SERVICE_ROLE_KEY|JWT_SECRET|PGRST_DB_SCHEMAS)=' /opt/supabase/docker/.env")
env = {}
for line in o.split('\n'):
    if '=' in line:
        k, v = line.split('=', 1); env[k] = v.strip()
print(f"ANON_KEY: {env['ANON_KEY'][:60]}...")

# Also get supabase URL — envoy is on port 8000
o2, _ = run("grep -E 'EXTERNAL|APP_URL|API_URL' /opt/supabase/docker/.env 2>/dev/null; echo '---'; hostname -I | awk '{print $1}'")
print(f"Server IP: {o2}")

SUPABASE_URL = f"http://43.133.232.81:8000"
ANON_KEY = env['ANON_KEY']

# ============================================================
# 2. Update frontend .env.production
# ============================================================
print("\n" + "=" * 70)
print("2. Read & update /workspace/wms-app/.env.production")
print("=" * 70)

env_file = "/workspace/wms-app/.env.production"
print(f"File exists: {os.path.exists(env_file)}")
if os.path.exists(env_file):
    with open(env_file) as f:
        content = f.read()
    print("Current content:")
    for line in content.split('\n'):
        if line.strip() and not line.startswith('#'):
            print(f"  {line[:80]}")

    # Update values
    lines = content.split('\n')
    new_lines = []
    for line in lines:
        if line.startswith('VITE_SUPABASE_URL='):
            new_lines.append(f"VITE_SUPABASE_URL={SUPABASE_URL}")
            print(f"  UPDATED SUPABASE_URL → {SUPABASE_URL}")
        elif line.startswith('VITE_SUPABASE_ANON_KEY='):
            new_lines.append(f"VITE_SUPABASE_ANON_KEY={ANON_KEY}")
            print(f"  UPDATED ANON_KEY → {ANON_KEY[:60]}...")
        else:
            new_lines.append(line)
    content = '\n'.join(new_lines)
    with open(env_file, 'w') as f:
        f.write(content)
    print("Saved.")
else:
    # Create it
    content = f"""VITE_SUPABASE_URL={SUPABASE_URL}
VITE_SUPABASE_ANON_KEY={ANON_KEY}
"""
    with open(env_file, 'w') as f:
        f.write(content)
    print(f"Created new .env.production")

# ============================================================
# 3. Build frontend
# ============================================================
print("\n" + "=" * 70)
print("3. npm run build")
print("=" * 70)
os.chdir("/workspace/wms-app")
result = subprocess.run(["npm", "run", "build"], capture_output=True, text=True, timeout=180)
print(result.stdout[-2000:])
if result.returncode != 0:
    print("STDERR:", result.stderr[-1000:])
    print("Build FAILED!")
    exit(1)

# ============================================================
# 4. Deploy to server
# ============================================================
print("\n" + "=" * 70)
print("4. Deploy to /var/www/wms/")
print("=" * 70)

# Check what we have
dist_dir = "/workspace/wms-app/dist"
import glob
files = glob.glob(dist_dir + "/**/*", recursive=True)
print(f"dist/ has {len(files)} files")

# Create tarball
tar_path = "/tmp/wms-dist.tar.gz"
subprocess.run(["tar", "-czf", tar_path, "-C", dist_dir, "."], check=True)
print(f"Tarball: {os.path.getsize(tar_path)} bytes")

# Copy to server
s = socket.socket(); s.settimeout(15)
s.connect(('127.0.0.1', 18080))
s.sendall(b"CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n")
t = paramiko.Transport(s); t.start_client(timeout=15); t.auth_password('ubuntu', 'Yuan340364#')

sftp = paramiko.SFTPClient.from_transport(t)
sftp.put(tar_path, '/tmp/wms-dist.tar.gz')
sftp.close(); t.close(); s.close()
print("Uploaded tarball")

# Deploy on server
o, e = run("""sudo mkdir -p /var/www/wms && \
  sudo rm -rf /var/www/wms/* && \
  sudo tar -xzf /tmp/wms-dist.tar.gz -C /var/www/wms && \
  sudo chown -R www-data:www-data /var/www/wms 2>/dev/null || \
  sudo chown -R ubuntu:ubuntu /var/www/wms && \
  ls -la /var/www/wms/ | head -20 && \
  echo '---' && \
  sudo find /var/www/wms -name '*.html' -o -name '*.js' | head -20""")
print(o[:2000])
if e: print("[ERR]", e[:500])

# ============================================================
# 5. Verify via curl
# ============================================================
print("\n" + "=" * 70)
print("5. Verify frontend accessible")
print("=" * 70)
o, e = run("curl -sS -o /dev/null -w 'HTTP %{http_code}, size=%{size_download}\n' http://localhost:8080/ 2>/dev/null || curl -sS -o /dev/null -w 'HTTP %{http_code}\n' http://localhost:80/ 2>/dev/null || echo 'no web server found, checking nginx...'")
print(o)

o, e = run("""which nginx 2>/dev/null; ls /etc/nginx/sites-enabled/ 2>/dev/null; cat /etc/nginx/sites-enabled/* 2>/dev/null | head -30; \
echo '---'; cat /etc/nginx/nginx.conf 2>/dev/null | grep -A5 'server_name\|listen\|root' | head -20""")
print(o[:1000])
