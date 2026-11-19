#!/usr/bin/env python3
"""Check docker compose basics"""
import socket, paramiko

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

# Basic checks
print("=== docker version ===")
ec, out, _ = sudo("docker --version && docker compose version 2>&1")
print(out)

print("\n=== ls /opt/supabase/docker/ ===")
ec, out, _ = sudo("ls -la /opt/supabase/docker/")
print(out)

print("\n=== cat .env (head) ===")
ec, out, _ = sudo("head -5 /opt/supabase/docker/.env && echo '---' && grep -c '' /opt/supabase/docker/.env && wc -c /opt/supabase/docker/.env")
print(out)

print("\n=== Last 3 lines of .env (check for trailing newline) ===")
ec, out, _ = sudo("tail -c 200 /opt/supabase/docker/.env | xxd | tail -10")
print(out)

# Try absolute path compose
print("\n=== docker compose with -f absolute path ===")
ec, out, err = sudo("docker compose -f /opt/supabase/docker/docker-compose.yml --env-file /opt/supabase/docker/.env config 2>&1 | head -30")
print(f"ec={ec}")
print(f"stdout: {out[:1000]}")
print(f"stderr: {err[:1000]}")

# Also check backup .env
print("\n=== .env.bak exists? ===")
ec, out, _ = sudo("ls -la /opt/supabase/docker/.env* 2>&1")
print(out)

# Test: cat the problematic lines
print("\n=== Extract JWT_SECRET line from .env ===")
ec, out, _ = sudo("grep 'JWT_SECRET' /opt/supabase/docker/.env | cat -A")
print(out)

print("\n=== Extract ANON_KEY line from .env ===")
ec, out, _ = sudo("grep 'ANON_KEY' /opt/supabase/docker/.env | cat -A")
print(out)

t.close()
