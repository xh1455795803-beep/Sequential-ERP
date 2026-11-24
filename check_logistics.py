import socket, time, paramiko

proxy = socket.socket()
proxy.connect(('127.0.0.1', 18080))
proxy.send(b'CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n')
resp = b''
while b'\r\n\r\n' not in resp:
    chunk = proxy.recv(4096)
    if not chunk: break
    resp += chunk
time.sleep(0.8)

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('43.133.232.81', username='ubuntu', password='yuan340364#', sock=proxy)

def run(label, cmd):
    print('\n[' + label + ']')
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=60)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    if out:
        print(out[:1200])
    if err and 'NOTICE' not in err:
        print('STDERR:', err[:500])

# logistics-tracking 源文件
run("sync-logistics-tracking 源",
    "cat /opt/supabase/docker/volumes/functions/sync-logistics-tracking/index.ts")

# logistics_tracking 表结构
run("logistics_tracking 表结构",
    "docker exec supabase-db psql -U postgres -c \"\\d tlv_logistics_tracking\"")

# 看表现有数据
run("logistics_tracking 现有数据",
    "docker exec supabase-db psql -U postgres -c \"SELECT * FROM tlv_logistics_tracking;\"")

ssh.close()
