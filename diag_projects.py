import socket, time, paramiko

HOST = '43.133.232.81'; USER='ubuntu'; PASS='yuan340364#'
proxy = socket.socket(); proxy.connect(('127.0.0.1', 18080))
proxy.send(b'CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n')
time.sleep(0.6)
ssh = paramiko.SSHClient(); ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, sock=proxy)

dirs = [
    '/home/ubuntu/erp',
    '/home/ubuntu/wms-app',
    '/home/ubuntu/thalvior-app',
    '/opt/thalvior-source',
    '/var/www/meoo',
]
for d in dirs:
    print(f'\n{"="*60}')
    print(f'目录: {d}')
    print('=' * 60)
    stdin, stdout, stderr = ssh.exec_command(f'ls -la {d}/ 2>&1 | head -20', timeout=10)
    print(stdout.read().decode())
    stdin, stdout, stderr = ssh.exec_command(f'cat {d}/package.json 2>/dev/null || echo "(无 package.json)"', timeout=10)
    pkg = stdout.read().decode()
    if pkg != '(无 package.json)':
        import json
        try:
            j = json.loads(pkg)
            print(f'  name: {j.get("name")}')
            print(f'  scripts: {list(j.get("scripts",{}).keys())}')
        except: pass

ssh.close()
