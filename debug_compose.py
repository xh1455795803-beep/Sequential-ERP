#!/usr/bin/env python3
"""Debug docker compose up failure"""
import socket, paramiko, time

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

# Check if containers were really removed
print("=== docker ps -a ===")
ec, out, _ = sudo("docker ps -a --format '{{.Names}} {{.Status}}' | grep supabase")
print(out)

# Try compose config first to see if yaml is valid
print("\n=== docker compose config ===")
ec, out, err = sudo("cd /opt/supabase/docker && docker compose config 2>&1 | tail -50")
print(f"ec={ec}")
print(f"stdout:\n{out[-2000:]}")
print(f"stderr:\n{err[-2000:]}")

# Try compose up with verbose
print("\n=== docker compose up -d auth (verbose) ===")
ec, out, err = sudo("cd /opt/supabase/docker && docker compose up -d auth 2>&1")
print(f"ec={ec}")
print(f"stdout: {out}")
print(f"stderr: {err}")

# Also test .env parsing
print("\n=== Source .env and check JWT vars ===")
ec, out, _ = sudo("cd /opt/supabase/docker && source .env && echo \"JWT_SECRET=$JWT_SECRET\" && echo \"ANON_KEY=$ANON_KEY\" && echo \"SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY\"")
print(out)

t.close()
