#!/usr/bin/env python3
"""P0-2 v2: 找 .env 文件并改 auth 相关变量"""
import socket, time, paramiko

HOST = '43.133.232.81'
USER = 'ubuntu'
PASS = 'yuan340364#'

proxy = socket.socket()
proxy.connect(('127.0.0.1', 18080))
proxy.send(b'CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n')
buf = b''
while b'\r\n\r\n' not in buf:
    chunk = proxy.recv(4096)
    if not chunk: break
    buf += chunk
time.sleep(0.6)
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, sock=proxy)

def do(label, cmd):
    print('\n=== [' + label + '] ===')
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=30)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    if out: print(out[:500])
    if err: print('ERR:', err[:300])

# 找 .env 文件
do('1. 找 .env 文件',
    "find /opt/supabase -name '.env*' -o -name 'env*' 2>/dev/null | head -10")

do('2. 看 .env 里的 auth 相关变量',
    "cat /opt/supabase/docker/.env 2>/dev/null | grep -E 'SIGNUP|AUTOCONFIRM|PASSWORD' || "
    "cat /opt/supabase/.env 2>/dev/null | grep -E 'SIGNUP|AUTOCONFIRM|PASSWORD'")

# 用 sed 直接改 .env
do('3. 修改 .env — 关开放注册 + 关自动确认',
    "sudo python3 << 'PYEOF'\n"
    "import os\n"
    "candidates = ['/opt/supabase/docker/.env', '/opt/supabase/.env']\n"
    "for p in candidates:\n"
    "    if os.path.exists(p):\n"
    "        with open(p) as f: lines = f.readlines()\n"
    "        new_lines = []\n"
    "        changed = 0\n"
    "        for line in lines:\n"
    "            if line.startswith('DISABLE_SIGNUP=') or line.startswith('ENABLE_SIGNUP='):\n"
    "                new_lines.append('DISABLE_SIGNUP=true\\n')\n"
    "                changed += 1\n"
    "                print(' 改 SIGNUP -> true')\n"
    "            elif line.startswith('ENABLE_EMAIL_AUTOCONFIRM='):\n"
    "                new_lines.append('ENABLE_EMAIL_AUTOCONFIRM=false\\n')\n"
    "                changed += 1\n"
    "                print(' 改 AUTOCONFIRM -> false')\n"
    "            elif line.startswith('ENABLE_EMAIL_SIGNUP='):\n"
    "                new_lines.append('ENABLE_EMAIL_SIGNUP=false\\n')\n"
    "                changed += 1\n"
    "                print(' 改 EMAIL_SIGNUP -> false')\n"
    "            else:\n"
    "                new_lines.append(line)\n"
    "        if changed > 0:\n"
    "            with open(p, 'w') as f: f.writelines(new_lines)\n"
    "            print('✅ ' + p + ' 已改 ' + str(changed) + ' 处')\n"
    "        else:\n"
    "            print(p + ' 里没有要改的变量，添加进去')\n"
    "            with open(p, 'a') as f:\n"
    "                f.write('\\n# Auth 生产安全加固\\n')\n"
    "                f.write('DISABLE_SIGNUP=true\\n')\n"
    "                f.write('ENABLE_EMAIL_AUTOCONFIRM=false\\n')\n"
    "                f.write('ENABLE_EMAIL_SIGNUP=false\\n')\n"
    "                f.write('GOTRUE_PASSWORD_MIN_LENGTH=8\\n')\n"
    "            print('✅ 已追加到 ' + p)\n"
    "        break\n"
    "else:\n"
    "    print('⚠️ 没找到任何 .env 文件')\n"
    "PYEOF")

# 用 docker compose up -d 重建 auth 容器
do('4. docker compose up -d auth（重建容器带新 env）',
    "cd /opt/supabase/docker && "
    "docker compose up -d auth 2>&1 | tail -10 && "
    "sleep 4 && "
    "docker ps --filter name=supabase-auth --format '{{.Names}} {{.Status}}' && "
    "echo '--- 验证新 env ---' && "
    "docker inspect supabase-auth --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -E 'SIGNUP|AUTOCONFIRM'")

ssh.close()
print('\n✅ P0-2 Auth — 生产加固完成')
