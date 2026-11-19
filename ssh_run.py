#!/usr/bin/env python3
import socket
import sys
import paramiko

PROXY_HOST = '127.0.0.1'
PROXY_PORT = 18080
TARGET_HOST = '43.133.232.81'
TARGET_PORT = 22
USER = 'ubuntu'
PASSWORD = 'Yuan340364#'

commands = [
    '''echo "=== REALTIME LOGS ==="; sudo docker logs supabase-realtime --tail 80 2>&1''',
    '''echo "=== REALTIME HEALTHCHECK ==="; sudo docker inspect supabase-realtime --format '{{.State.Health.Status}}' 2>&1; sudo docker inspect supabase-realtime --format '{{json .State.Health.Log}}' 2>&1 | python3 -m json.tool 2>&1 | tail -30''',
    '''echo "=== FREE MEM NOW ==="; free -m; echo; echo "=== TOP MEM ==="; ps aux --sort=-%mem | head -15; echo; echo "=== TOP CPU ==="; ps aux --sort=-%cpu | head -10''',
    '''echo "=== SWAP DETAIL ==="; swapon --show; cat /proc/swaps 2>&1; echo; echo "=== VMSTAT ==="; vmstat 1 5''',
    '''echo "=== DISK SPACE BACKUPS ==="; sudo du -sh /var/www/meoo.bak* /var/www/meoo_backup* 2>/dev/null | sort -rh | head -30; echo; sudo du -sh /var/www/meoo/ 2>/dev/null; echo; sudo du -sh /var/www/ 2>/dev/null''',
    '''echo "=== FASTAPI CONTAINER CHECK ==="; sudo docker logs thalvior_app --tail 30 2>&1; echo; sudo docker port thalvior_app 2>&1; echo; sudo curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8021/docs 2>&1''',
    '''echo "=== WORDPRESS DETAILS ==="; sudo docker logs woo-test-wp-1 --tail 15 2>&1; echo; sudo docker inspect woo-test-wp-1 --format '{{.HostConfig.PortBindings}}' 2>&1''',
    '''echo "=== NORMAL SUPABASE LOGS ==="; sudo docker logs supabase-db --tail 10 2>&1; echo; sudo docker logs supabase-envoy --tail 10 2>&1''',
]

# Step 1: Open TCP to proxy
print("Connecting to proxy %s:%d ..." % (PROXY_HOST, PROXY_PORT), flush=True)
proxy_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
proxy_sock.settimeout(30)
proxy_sock.connect((PROXY_HOST, PROXY_PORT))
print("Connected to proxy.", flush=True)

# Step 2: HTTP CONNECT
connect_req = ("CONNECT %s:%d HTTP/1.1\r\n"
               "Host: %s:%d\r\n"
               "User-Agent: python-proxy-connect\r\n"
               "\r\n") % (TARGET_HOST, TARGET_PORT, TARGET_HOST, TARGET_PORT)
proxy_sock.sendall(connect_req.encode())

# Read response
resp = b''
while b'\r\n\r\n' not in resp:
    chunk = proxy_sock.recv(4096)
    if not chunk:
        break
    resp += chunk
print("Proxy response:", resp.decode(errors='replace'), flush=True)

if b'200' not in resp.split(b'\r\n')[0]:
    print("Proxy CONNECT failed!", file=sys.stderr)
    sys.exit(1)

# Step 3: Paramiko over this socket
print("Starting SSH handshake via paramiko...", flush=True)
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

# Try paramiko 4.x style first
try:
    client.connect(
        hostname=TARGET_HOST,
        port=TARGET_PORT,
        username=USER,
        password=PASSWORD,
        sock=proxy_sock,
        timeout=30,
        banner_timeout=30,
        auth_timeout=30,
        look_for_keys=False,
        allow_agent=False,
    )
except TypeError as e:
    print("TypeError:", e, flush=True)
    # fallback: create transport manually
    transport = paramiko.Transport(proxy_sock)
    transport.connect(username=USER, password=PASSWORD)
    client = paramiko.SSHClient()
    client._transport = transport

print("SSH connected!", flush=True)

# Use a single sudo session to cache credentials? Actually each command has sudo.
# We need to handle sudo password prompt for each command.
# Let's use exec_command and then write password on stdin if needed.

import time

for i, cmd in enumerate(commands, 1):
    print("\n" + "=" * 80, flush=True)
    print("COMMAND %d: %s" % (i, cmd), flush=True)
    print("=" * 80, flush=True)
    try:
        # For sudo commands, wrap with a mechanism to feed password
        # Actually let's use bash -c and echo password via stdin for sudo
        # Simpler: modify sudo to accept stdin password
        wrapped = cmd.replace('sudo ', 'echo "Yuan340364#" | sudo -S ')
        stdin, stdout, stderr = client.exec_command(wrapped, timeout=120)
        out = stdout.read().decode(errors='replace')
        err = stderr.read().decode(errors='replace')
        if err:
            # Print stderr first as requested? User says every line of output verbatim
            print("[stderr]")
            print(err)
        print(out)
    except Exception as e:
        print("ERROR on command %d: %s" % (i, e))
    sys.stdout.flush()

client.close()
print("\nDone.")
