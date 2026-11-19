#!/usr/bin/env python3
"""P0-0: 快速检查服务器真实状态——不猜，看证据。"""
import socket, paramiko, time, json

def ssh_exec(cmd):
    s = socket.socket()
    s.connect(('127.0.0.1', 18080))
    s.sendall(b"CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n")
    t = paramiko.Transport(s); t.start_client(); t.auth_password('ubuntu', 'Yuan340364#')
    chan = t.open_session(); chan.exec_command(cmd)
    out = chan.recv(65535).decode(); err = chan.recv_stderr(65535).decode()
    t.close(); s.close()
    return out.strip(), err.strip()

CMP = "docker compose -f /opt/supabase/docker/docker-compose.yml --env-file /opt/supabase/docker/.env"

def run(cmd):
    out, err = ssh_exec(cmd)
    return out, err

print("=" * 70)
print("1. Container status")
print("=" * 70)
o, e = run(f"{CMP} ps")
print(o)
if e: print("[STDERR]", e)

print("\n" + "=" * 70)
print("2. .env JWT-related values (masked)")
print("=" * 70)
o, e = run("grep -E '^(JWT_SECRET|ANON_KEY|SERVICE_ROLE_KEY|PGRST)' /opt/supabase/docker/.env | sed 's/=.*/=***/'")
print(o)

print("\n" + "=" * 70)
print("3. docker-compose.yml rest service env block")
print("=" * 70)
o, e = run("grep -A 40 'container_name: supabase-rest' /opt/supabase/docker/docker-compose.yml | head -50")
print(o)

print("\n" + "=" * 70)
print("4. Postgrest running config (JWT)")
print("=" * 70)
o, e = run("docker exec supabase-rest postgrest --dump-config 2>&1 | grep -iE 'jwt|role|secret|guc' | head -30")
print(o[:3000])

print("\n" + "=" * 70)
print("5. Current request.* and app.* GUCs (as supabase_admin)")
print("=" * 70)
o, e = run("""docker exec supabase-db psql -U supabase_admin -d postgres -c "
SELECT name, current_setting(name, true) as val
FROM pg_settings
WHERE name LIKE 'request.%' OR name LIKE 'app.%'
ORDER BY name;" """)
print(o)

print("\n" + "=" * 70)
print("6. Postgrest recent logs (last 30s)")
print("=" * 70)
o, e = run("docker logs supabase-rest --since 30s 2>&1 | tail -30")
print(o)

print("\n" + "=" * 70)
print("7. Check if postgrest_debug_log table exists")
print("=" * 70)
o, e = run("""docker exec supabase-db psql -U supabase_admin -d postgres -c "
SELECT tablename FROM pg_tables WHERE tablename LIKE '%debug%';" """)
print(o)

print("\n" + "=" * 70)
print("8. pre_request function check")
print("=" * 70)
o, e = run("""docker exec supabase-db psql -U supabase_admin -d postgres -c "
SELECT proname, prosecdef FROM pg_proc WHERE proname LIKE '%pgrst%' OR proname LIKE '%debug%';" """)
print(o)
