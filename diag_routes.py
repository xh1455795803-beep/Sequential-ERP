import socket, time, paramiko

HOST = '43.133.232.81'; USER='ubuntu'; PASS='yuan340364#'
proxy = socket.socket(); proxy.connect(('127.0.0.1', 18080))
proxy.send(b'CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n')
time.sleep(0.6)
ssh = paramiko.SSHClient(); ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, sock=proxy)

# ERP 的 routeTree.gen.ts 里有所有路由
print('=== ERP 路由 ===')
stdin, stdout, stderr = ssh.exec_command(
    "grep -o 'path.*:' /opt/thalvior-source/src/routeTree.gen.ts | head -40",
    timeout=10)
print(stdout.read().decode())

# ERP routes 目录
print('\n=== ERP src/routes ===')
stdin, stdout, stderr = ssh.exec_command('ls /opt/thalvior-source/src/routes/ 2>&1', timeout=10)
print(stdout.read().decode())

# 有没有 landing / auth / login 页面？
print('\n=== ERP 有没有 landing/login/auth ===')
stdin, stdout, stderr = ssh.exec_command(
    "find /opt/thalvior-source/src -iname '*landing*' -o -iname '*login*' -o -iname '*register*' -o -iname '*auth*' 2>&1 | grep -v node_modules",
    timeout=10)
print(stdout.read().decode())

# ERP src/router.tsx 看看路由定义
print('\n=== ERP router.tsx 前80行 ===')
stdin, stdout, stderr = ssh.exec_command('cat /opt/thalvior-source/src/router.tsx 2>&1 | head -80', timeout=10)
print(stdout.read().decode())

# ERP 现有 build 的 index.html title
print('\n=== ERP dist (meoo) index.html ===')
stdin, stdout, stderr = ssh.exec_command('cat /var/www/meoo/index.html 2>&1', timeout=10)
print(stdout.read().decode())

# WMS 项目的路由
print('\n=== WMS (wms-app) 路由 ===')
stdin, stdout, stderr = ssh.exec_command(
    "grep 'path:' /home/ubuntu/wms-app/src/main.tsx 2>&1",
    timeout=10)
print(stdout.read().decode())

ssh.close()
