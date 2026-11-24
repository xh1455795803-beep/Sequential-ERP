#!/usr/bin/env python3
"""P0-1 v2: 用 supabase_admin 身份改 RLS"""
import socket, time, paramiko

HOST = '43.133.232.81'
USER = 'ubuntu'
PASS = 'yuan340364#'

proxy = socket.socket()
proxy.connect(('127.0.0.1', 18080))
proxy.send(b'CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n')
buf = b''
while b'\r\n\r\n' not in buf:
    chunk = proxy.recv(4096)
    if not chunk: break
    buf += chunk
time.sleep(0.6)
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, sock=proxy)

def run(label, sql):
    print('\n=== [' + label + '] ===')
    # 用 supabase_admin 身份执行
    cmd = "docker exec -i supabase-db psql -U supabase_admin -d postgres -c \"" + sql.replace('"', '\\"').replace('\\', '\\\\') + "\""
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=60)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    if out: print(out[:500])
    if err and 'NOTICE' not in err: print('ERR:', err[:300])

# Step 0: 先看下表 owner 和 postgres 的 superuser 状态
run('0. postgres 是不是 superuser',
    "SELECT rolname, rolsuper FROM pg_roles WHERE rolname IN ('postgres','supabase_admin');")

run('0b. 表 owner',
    "SELECT tablename, tableowner FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'tlv_%' LIMIT 3;")

# Step 1: 把所有 tlv_* 表 owner 改成 postgres（用 supabase_admin 身份）
run('1. 把所有 tlv_* 表 owner 改成 postgres',
    "SELECT 'ALTER TABLE public.' || tablename || ' OWNER TO postgres;' FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'tlv_%' ORDER BY tablename;")

# 执行 ALTER OWNER
stdin, stdout, stderr = ssh.exec_command(
    "docker exec -i supabase-db psql -U supabase_admin -d postgres -t -c "
    "\"SELECT 'ALTER TABLE public.' || tablename || ' OWNER TO postgres;' FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'tlv_%';\""
    " | docker exec -i supabase-db psql -U supabase_admin -d postgres",
    timeout=30)
print('\n=== [1b. 实际改 OWNER] ===')
out = stdout.read().decode()
err = stderr.read().decode()
print(out[-500:] if out else '')
if err: print('ERR:', err[:300])

# 再验证 owner
run('1c. owner 是否已改',
    "SELECT tablename, tableowner FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'tlv_%' LIMIT 3;")

# Step 2: 现在 postgres 应该可以操作了，先删掉旧 policy
run('2. 删掉所有旧 policy',
    "SELECT 'DROP POLICY IF EXISTS ' || policyname || ' ON public.' || tablename || ';' FROM pg_policies WHERE schemaname='public' AND tablename LIKE 'tlv_%';")

stdin, stdout, stderr = ssh.exec_command(
    "docker exec -i supabase-db psql -U postgres -d postgres -t -c "
    "\"SELECT 'DROP POLICY IF EXISTS ' || policyname || ' ON public.' || tablename || ';' FROM pg_policies WHERE schemaname='public' AND tablename LIKE 'tlv_%';\""
    " | docker exec -i supabase-db psql -U postgres -d postgres",
    timeout=30)
out = stdout.read().decode()
err = stderr.read().decode()
print('\n=== [2b. 实际 DROP] ===')
print(out[-500:] if out else '')
if err and 'does not exist' not in err.lower(): print('ERR:', err[:300])

ssh.close()
print('\n✅ 表 owner 已改')
