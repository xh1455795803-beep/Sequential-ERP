import paramiko
import sys
import os

HOST = '120.55.6.7'
PORT = 22
USER = 'admin'
PASS = 'yuan340364'

LOCAL_BASE = '/workspace/deploy'
REMOTE_BACKEND = '/opt/shuxu-erp/backend/src'
REMOTE_FRONTEND = '/opt/shuxu-erp/admin'

FILES = [
    ('platforms/index.js', f'{REMOTE_BACKEND}/platforms/index.js'),
    ('platforms/stubs.js', f'{REMOTE_BACKEND}/platforms/stubs.js'),
    ('sync-service.js', f'{REMOTE_BACKEND}/sync-service.js'),
    ('routes/oauth.js', f'{REMOTE_BACKEND}/routes/oauth.js'),
    ('admin/index.html', f'{REMOTE_FRONTEND}/index.html'),
]

def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        print(f'[*] Connecting to {USER}@{HOST}:{PORT}...')
        ssh.connect(HOST, port=PORT, username=USER, password=PASS, timeout=15, auth_timeout=15, banner_timeout=15)
        print('[+] SSH connected.')
    except Exception as e:
        print(f'[!] SSH connect failed: {e}')
        sys.exit(1)

    sftp = ssh.open_sftp()
    try:
        # 先创建 platforms 目录（怕不存在）
        try:
            sftp.stat(f'{REMOTE_BACKEND}/platforms')
        except IOError:
            print(f'[*] Creating {REMOTE_BACKEND}/platforms dir...')
            sftp.mkdir(f'{REMOTE_BACKEND}/platforms')

        for (local_rel, remote) in FILES:
            local = os.path.join(LOCAL_BASE, local_rel)
            if not os.path.exists(local):
                print(f'[!] Missing local file: {local}')
                sys.exit(2)
            print(f'[*] Uploading {local_rel} -> {remote}')
            sftp.put(local, remote)
            print(f'[+] OK: {local_rel} ({os.path.getsize(local)} bytes)')
    finally:
        sftp.close()

    # 在服务器执行语法检查 + 重启服务
    cmds = [
        f'cd {REMOTE_BACKEND} && node --check routes/oauth.js && echo "[check] oauth.js OK"',
        f'cd {REMOTE_BACKEND} && node --check sync-service.js && echo "[check] sync-service.js OK"',
        f'cd {REMOTE_BACKEND} && node --check platforms/index.js && echo "[check] platforms/index.js OK"',
        # 重启后端服务 - 先找一下进程或systemd
        'ps -ef | grep -E "node|server|index\\.js" | grep -v grep | head -5',
        'ls -la /opt/shuxu-erp/ 2>&1',
        # 查看服务管理方式
        'systemctl list-units --type=service | grep -iE "shuxu|erp|node" 2>&1 | head -10; echo ---; ls /etc/systemd/system/ | grep -iE "shuxu|erp" 2>&1',
    ]
    for cmd in cmds:
        print(f'\\n[EXEC] $ {cmd}')
        stdin, stdout, stderr = ssh.exec_command(cmd, timeout=30)
        out = stdout.read().decode('utf-8', errors='ignore').strip()
        err = stderr.read().decode('utf-8', errors='ignore').strip()
        if out:
            print(out)
        if err:
            print('[STDERR]', err)

    ssh.close()
    print('\\n[+] Done.')

if __name__ == '__main__':
    main()
