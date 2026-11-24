#!/usr/bin/env python3
"""P0-2 Auth 修复 — 改 docker-compose 里的 auth 环境变量"""
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

# 1. 先看 auth 容器当前这几个关键 env
do('1. 当前 auth 关键 env',
    "docker inspect supabase-auth --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -E 'SIGNUP|AUTOCONFIRM|PASSWORD_MIN|SMTP_ADMIN'")

# 2. 用 docker update 临时改 auth 容器 env（立即生效验证）
# 注意：docker update --env 是增量的，旧值需要先清
do('2. 临时改 auth 容器 env',
    "docker update supabase-auth "
    "--env GOTRUE_DISABLE_SIGNUP=true "
    "--env GOTRUE_MAILER_AUTOCONFIRM=false "
    "&& docker restart supabase-auth && sleep 3 && "
    "docker inspect supabase-auth --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -E 'SIGNUP|AUTOCONFIRM' && "
    "docker ps --filter name=supabase-auth --format '{{.Names}} {{.Status}}'")

# 3. 改 docker-compose.yml 永久生效
# 先备份
do('3. 备份 docker-compose.yml',
    "sudo cp /opt/supabase/docker/docker-compose.yml /opt/supabase/docker/docker-compose.yml.bak.$(date +%s) && "
    "ls -lt /opt/supabase/docker/docker-compose.yml.bak.* | head -2")

# 用 Python 直接改文件（sed 可能有权限问题）
do('4. 修改 docker-compose.yml 里的 auth env',
    "sudo python3 << 'PYEOF'\n"
    "import re\n"
    "path = '/opt/supabase/docker/docker-compose.yml'\n"
    "with open(path) as f: content = f.read()\n"
    "orig = content\n"
    "\n"
    "# GOTRUE_DISABLE_SIGNUP\n"
    "content = re.sub(r'GOTRUE_DISABLE_SIGNUP=false', 'GOTRUE_DISABLE_SIGNUP=true', content)\n"
    "# GOTRUE_MAILER_AUTOCONFIRM\n"
    "content = re.sub(r'GOTRUE_MAILER_AUTOCONFIRM=true', 'GOTRUE_MAILER_AUTOCONFIRM=false', content)\n"
    "# 加强密码策略（如果不存在）\n"
    "if 'GOTRUE_PASSWORD_MIN_LENGTH' not in content:\n"
    "    content += '\\n  auth:\\n    environment:\\n      GOTRUE_PASSWORD_MIN_LENGTH: 8\\n'\n"
    "\n"
    "if content == orig:\n"
    "    print('⚠️  docker-compose 里没找到要改的行（可能用的 .env 变量）')\n"
    "else:\n"
    "    with open(path, 'w') as f: f.write(content)\n"
    "    print('✅ docker-compose.yml 已更新')\n"
    "\n"
    "# 显示改动\n"
    "import subprocess\n"
    "result = subprocess.run(['grep', '-n', 'SIGNUP\\|AUTOCONFIRM', path], capture_output=True, text=True)\n"
    "print(result.stdout[:500])\n"
    "PYEOF")

# 4. 最终重启并验证
do('5. 最终重启 + 验证',
    "docker restart supabase-auth && sleep 4 && "
    "docker ps --filter name=supabase-auth --format '{{.Names}} {{.Status}}' && "
    "docker inspect supabase-auth --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -E 'SIGNUP|AUTOCONFIRM|PASSWORD'")

ssh.close()
print('\n✅ P0-2 Auth 生产配置 — DONE')
