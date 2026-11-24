import socket, time, paramiko

HOST = '43.133.232.81'; USER='ubuntu'; PASS='yuan340364#'
proxy = socket.socket(); proxy.connect(('127.0.0.1', 18080))
proxy.send(b'CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n')
time.sleep(0.6)
ssh = paramiko.SSHClient(); ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, sock=proxy)

print('=== ERP src/routes/index.tsx (首页) ===')
stdin, stdout, stderr = ssh.exec_command('cat /opt/thalvior-source/src/routes/index.tsx 2>&1', timeout=10)
print(stdout.read().decode()[:800])

print('\n=== ERP src/routes/login.tsx ===')
stdin, stdout, stderr = ssh.exec_command('cat /opt/thalvior-source/src/routes/login.tsx 2>&1 | head -60', timeout=10)
print(stdout.read().decode())

print('\n=== ERP src/routes/register.tsx ===')
stdin, stdout, stderr = ssh.exec_command('cat /opt/thalvior-source/src/routes/register.tsx 2>&1 | head -60', timeout=10)
print(stdout.read().decode())

print('\n=== ERP src/routes/__root.tsx ===')
stdin, stdout, stderr = ssh.exec_command('cat /opt/thalvior-source/src/routes/__root.tsx 2>&1 | head -60', timeout=10)
print(stdout.read().decode())

print('\n=== ERP 有没有 Landing 组件？===')
stdin, stdout, stderr = ssh.exec_command(
    "find /opt/thalvior-source/src -iname '*landing*' -o -iname '*marketing*' -o -iname '*home*' -o -iname '*welcome*' 2>&1",
    timeout=10)
print(stdout.read().decode())

print('\n=== ERP 有没有 Header/Nav 组件？===')
stdin, stdout, stderr = ssh.exec_command(
    "find /opt/thalvior-source/src -iname '*header*' -o -iname '*navbar*' -o -iname '*nav*' 2>&1 | head -10",
    timeout=10)
print(stdout.read().decode())

print('\n=== ERP _layout.auth.tsx (auth 布局) ===')
stdin, stdout, stderr = ssh.exec_command('cat /opt/thalvior-source/src/routes/_layout.auth.tsx 2>&1 | head -50', timeout=10)
print(stdout.read().decode())

ssh.close()
