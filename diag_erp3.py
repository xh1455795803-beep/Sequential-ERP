import socket, time, paramiko

HOST = '43.133.232.81'; USER='ubuntu'; PASS='yuan340364#'
proxy = socket.socket(); proxy.connect(('127.0.0.1', 18080))
proxy.send(b'CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n')
time.sleep(0.6)
ssh = paramiko.SSHClient(); ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, sock=proxy)

# tailwind config
print('=== ERP tailwind.config ===')
stdin, stdout, stderr = ssh.exec_command('cat /opt/thalvior-source/tailwind.config.ts 2>&1 | head -40', timeout=10)
print(stdout.read().decode())

# global styles.css
print('\n=== ERP src/styles.css (前50行) ===')
stdin, stdout, stderr = ssh.exec_command('head -50 /opt/thalvior-source/src/styles.css 2>&1', timeout=10)
print(stdout.read().decode())

# 看看有哪些 shadcn 组件
print('\n=== ERP components/ui/ ===')
stdin, stdout, stderr = ssh.exec_command('ls /opt/thalvior-source/src/components/ui/ 2>&1', timeout=10)
print(stdout.read().decode())

# AuthShell 组件长什么样（登录页的外层包装）
print('\n=== ERP AuthShell ===')
stdin, stdout, stderr = ssh.exec_command('cat /opt/thalvior-source/src/components/auth-shell.tsx 2>&1', timeout=10)
print(stdout.read().decode()[:400])

# 看看 index.tsx 完整代码（之前被截断了）
print('\n=== ERP index.tsx 完整 ===')
stdin, stdout, stderr = ssh.exec_command('cat /opt/thalvior-source/src/routes/index.tsx 2>&1', timeout=10)
print(stdout.read().decode())

ssh.close()
