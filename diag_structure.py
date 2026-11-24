import socket, time, paramiko

HOST = '43.133.232.81'; USER='ubuntu'; PASS='yuan340364#'
proxy = socket.socket(); proxy.connect(('127.0.0.1', 18080))
proxy.send(b'CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n')
time.sleep(0.8)
ssh = paramiko.SSHClient(); ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, sock=proxy)

cmds = [
    ('===== /var/www/ 所有子目录 =====', 'ls -la /var/www/'),
    ('===== /home/ubuntu/ 顶层项目目录 =====', 'ls -la /home/ubuntu/ | grep -v "^total" | grep -v "\.bash\|^d.*\."'),
    ('===== /opt/ 顶层项目目录 =====', 'ls -la /opt/'),
    ('===== nginx sites-enabled =====', 'ls -la /etc/nginx/sites-enabled/'),
    ('===== nginx conf.d =====', 'ls -la /etc/nginx/conf.d/'),
    ('===== /var/www/meoo 目录 =====', 'ls /var/www/meoo/ 2>&1 | head -10'),
    ('===== /var/www/wms 目录 =====', 'ls /var/www/wms/ 2>&1 | head -10'),
    ('===== /var/www/landing 目录 =====', 'ls /var/www/landing/ 2>&1 | head -10'),
    ('===== 所有 DNS 域名指向 =====', 'dig +short thalvior.icu thalvior.fun 2>&1'),
    ('===== nginx server_name =====', 'sudo grep -r "server_name" /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>&1'),
    ('===== /home/ubuntu/ 项目源码（grep package.json）=====', 'find /home/ubuntu -maxdepth 3 -name package.json 2>/dev/null'),
    ('===== /opt 源码目录 =====', 'find /opt -maxdepth 3 -name package.json 2>/dev/null'),
]

for title, cmd in cmds:
    print(f'\n{title}')
    print('-' * 50)
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=15)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    print(out if out else '(无输出)')
    if err and 'warning' not in err.lower() and err != '(无输出)':
        print('STDERR:', err[:200])

ssh.close()
