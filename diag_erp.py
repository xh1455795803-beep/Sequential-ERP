import socket, time, paramiko

HOST = '43.133.232.81'; USER='ubuntu'; PASS='yuan340364#'
proxy = socket.socket(); proxy.connect(('127.0.0.1', 18080))
proxy.send(b'CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n')
time.sleep(0.6)
ssh = paramiko.SSHClient(); ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, sock=proxy)

# 1. 看 ERP (thalvior-source) 的 src 结构
print('=== /opt/thalvior-source/src/ 目录 ===')
stdin, stdout, stderr = ssh.exec_command('ls /opt/thalvior-source/src/ 2>&1', timeout=10)
print(stdout.read().decode())

# 2. 看 ERP package.json
print('=== thalvior-source/package.json scripts ===')
stdin, stdout, stderr = ssh.exec_command(
    "cat /opt/thalvior-source/package.json | python3 -c \"import json,sys; d=json.load(sys.stdin); print('name:', d.get('name')); print('scripts:', json.dumps(d.get('scripts',{}), indent=2)); print('deps count:', len(d.get('dependencies',{})))\" 2>&1",
    timeout=10)
print(stdout.read().decode())

# 3. 看 ERP dist 现有 index.html
print('=== /var/www/meoo/index.html ===')
stdin, stdout, stderr = ssh.exec_command('cat /var/www/meoo/index.html 2>&1', timeout=10)
print(stdout.read().decode()[:500])

# 4. 看 ERP 项目 vite/webpack 配置
print('=== thalvior-source vite.config.ts ===')
stdin, stdout, stderr = ssh.exec_command('cat /opt/thalvior-source/vite.config.ts 2>&1 | head -30', timeout=10)
print(stdout.read().decode())

# 5. ERP 能不能 build？
print('=== 试 build thalvior-source ===')
stdin, stdout, stderr = ssh.exec_command(
    'cd /opt/thalvior-source && npm run build 2>&1 | tail -20',
    timeout=120)
out = stdout.read().decode()
err = stderr.read().decode()
print(out[-500:] if out else '')
if err: print('STDERR:', err[-500:])

# 6. meoo dist vs wms dist
print('\n=== /var/www/meoo vs /var/www/wms ===')
stdin, stdout, stderr = ssh.exec_command('wc -c /var/www/meoo/assets/*.js /var/www/wms/assets/*.js 2>&1', timeout=10)
print(stdout.read().decode())

ssh.close()
