#!/usr/bin/env python3
"""补修 P0-2 Auth 生产配置 — 找对 auth 配置路径"""
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

def do(label, cmd):
    print('\n=== [' + label + '] ===')
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=30)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    if out: print(out[:500])
    if err: print('ERR:', err[:300])

# 1. auth 容器当前 env
do('1. auth 容器 env — 找 signup / email / password 相关',
    "docker inspect supabase-auth --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -iE 'SIGNUP|EMAIL|CONFIRM|PASSWORD|AUTH_' | sort")

# 2. 找 docker-compose 文件
do('2. 找 supabase docker-compose',
    "find / -name 'docker-compose.yml' -path '*supabase*' 2>/dev/null | head -5; "
    "find /opt/supabase -name '*.yml' -o -name '*.yaml' 2>/dev/null | head -10")

# 3. auth 有没有配置文件
do('3. auth 容器里找配置',
    "docker exec supabase-auth sh -c 'cat /tmp/config.json 2>/dev/null || find /etc /app -name \"*.json\" -o -name \"*.toml\" 2>/dev/null | head -10'")

# 4. Supabase 的 auth config 在 DB 的 auth schema 里
do('4. 在 postgres 的 auth schema 里找 config 表',
    "docker exec supabase-db psql -U postgres -d postgres -c "
    "\"SELECT schemaname, tablename FROM pg_tables WHERE schemaname LIKE 'auth%' ORDER BY schemaname;\"")

# 5. 查 auth.config 到底在哪个 schema
do('5. 找 auth.config 表',
    "docker exec supabase-db psql -U postgres -d postgres -c "
    "\"SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relname='config';\"")

ssh.close()
