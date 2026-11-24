import socket, time, paramiko

HOST = '43.133.232.81'; USER='ubuntu'; PASS='yuan340364#'
proxy = socket.socket(); proxy.connect(('127.0.0.1', 18080))
proxy.send(b'CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n')
time.sleep(0.6)
ssh = paramiko.SSHClient(); ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, sock=proxy)

# 看完整 nginx location 配置
print('=== nginx sites-enabled/meoo 关键 location 段 ===')
stdin, stdout, stderr = ssh.exec_command(
    "sudo sed -n '/server {/,/}/p' /etc/nginx/sites-enabled/meoo | grep -n -E 'location|root|alias|try_files|@spa|index'",
    timeout=15)
print(stdout.read().decode())

print('=== @spa 完整定义 ===')
stdin, stdout, stderr = ssh.exec_command(
    "sudo grep -A5 '@spa' /etc/nginx/sites-enabled/meoo", timeout=10)
print(stdout.read().decode())

print('=== /var/www/wms/index.html ===')
stdin, stdout, stderr = ssh.exec_command(
    "sudo cat /var/www/wms/index.html", timeout=10)
print(stdout.read().decode()[:500])

print('=== /var/www/landing/index.html ===')
stdin, stdout, stderr = ssh.exec_command(
    "sudo cat /var/www/landing/index.html 2>&1", timeout=10)
print(stdout.read().decode()[:500])

ssh.close()
