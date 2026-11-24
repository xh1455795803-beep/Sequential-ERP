#!/usr/bin/env python3
"""P0-1 v4: 先探测每张表的列，再精准加 policy"""
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

# Step 1: 探测每张表的 merchant_id / warehouse_id 列
print('=== [探测列结构] ===')
probe = """
SELECT table_name,
       EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t.table_name AND column_name='merchant_id') as has_mid,
       EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t.table_name AND column_name='warehouse_id') as has_wid
FROM information_schema.tables t
WHERE table_schema='public' AND table_name LIKE 'tlv_%'
ORDER BY table_name;
"""
stdin, stdout, stderr = ssh.exec_command(
    "docker exec supabase-db psql -U postgres -d postgres -c \"" + probe.replace('"', '\\"') + "\"",
    timeout=15)
print(stdout.read().decode())

ssh.close()
