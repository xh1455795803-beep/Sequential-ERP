import socket, time, paramiko

HOST = '43.133.232.81'; USER='ubuntu'; PASS='yuan340364#'
proxy = socket.socket(); proxy.connect(('127.0.0.1', 18080))
proxy.send(b'CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n')
time.sleep(0.8)
ssh = paramiko.SSHClient(); ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, sock=proxy)

# 1. 传 index.tsx
with open('/workspace/erp_index_tsx', 'r') as f:
    content = f.read()

# 用 base64 编码传过去，避免转义问题
import base64
b64 = base64.b64encode(content.encode()).decode()
cmd = f"echo '{b64}' | base64 -d | sudo tee /opt/thalvior-source/src/routes/index.tsx > /dev/null && echo 'OK'"
stdin, stdout, stderr = ssh.exec_command(cmd, timeout=10)
print('index.tsx:', stdout.read().decode().strip())

# 2. 验证写入
stdin, stdout, stderr = ssh.exec_command('head -5 /opt/thalvior-source/src/routes/index.tsx', timeout=10)
print('Verify:', stdout.read().decode())

# 3. build ERP
print('=== Build ERP ===')
stdin, stdout, stderr = ssh.exec_command(
    'cd /opt/thalvior-source && npm run build 2>&1 | tail -20',
    timeout=180)
out = stdout.read().decode()
print(out[-600:])

if '✓ built' not in out:
    print('❌ BUILD FAILED!')
    err = stderr.read().decode()
    print(err[-500:])
    ssh.close()
    exit(1)
print('✅ ERP Build OK')

# 4. 部署到 /var/www/meoo
print('\n=== Deploy ERP to /var/www/meoo ===')
stdin, stdout, stderr = ssh.exec_command(
    "sudo rm -rf /var/www/meoo/* && "
    "sudo cp -r /opt/thalvior-source/dist/* /var/www/meoo/ && "
    "sudo chown -R www-data:www-data /var/www/meoo && "
    "ls -la /var/www/meoo/ | head -5",
    timeout=15)
print(stdout.read().decode())

# 5. 验证
import requests, re
try:
    r = requests.get('https://thalvior.icu/', timeout=10)
    refs = re.findall(r'(?:src|href)="(/[^"]*assets/[^"]*)"', r.text)
    print(f'\n=== 访问根路径（当前 nginx 还指向 /var/www/wms，预期还是 wms 的）===')
    print(f'Status: {r.status_code}, JS refs: {refs}')
except Exception as e:
    print(f'Err: {e}')

ssh.close()
