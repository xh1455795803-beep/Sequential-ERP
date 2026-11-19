#!/usr/bin/env python3
import socket, paramiko, sys

def connect_via_http_proxy(host, port):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.connect(('127.0.0.1', 18080))
    s.sendall(f"CONNECT {host}:{port} HTTP/1.1\r\nHost: {host}:{port}\r\n\r\n".encode())
    response = b''
    while b'\r\n\r\n' not in response:
        chunk = s.recv(4096)
        if not chunk: raise ConnectionError("Proxy closed")
        response += chunk
    status_line = response.split(b'\r\n')[0].decode()
    if '200' not in status_line: raise ConnectionError(f"Proxy failed: {status_line}")
    return s

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('43.133.232.81', port=22, username='ubuntu', password='Yuan340364#', sock=connect_via_http_proxy('43.133.232.81', 22), timeout=30)
sftp = client.open_sftp()

steps = [
    '/tmp/wms_seed_step1.sql',
    '/tmp/wms_seed_step2.sql', 
    '/tmp/wms_seed_step3.sql',
    '/tmp/wms_seed_step4.sql',
    '/tmp/wms_seed_step5.sql',
    '/tmp/wms_seed_step6.sql',
]

for sql_path in steps:
    # Upload
    remote = f'/home/ubuntu/{sql_path.split("/")[-1]}'
    sftp.put(sql_path, remote)
    
    # Execute
    cmd = f"sudo docker exec -i supabase-db psql -U supabase_admin -d postgres -f {remote}"
    print(f"\n{'='*60}")
    print(f"EXECUTING: {sql_path}")
    print(f"{'='*60}")
    stdin, stdout, stderr = client.exec_command(cmd, timeout=60)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    if out:
        print("STDOUT:")
        print(out[-3000:])  # last 3000 chars
    if err:
        print("STDERR:")
        print(err[-1000:])
    print(f"{'='*60}\n")

sftp.close()
client.close()
print("ALL DONE!")
