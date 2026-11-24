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

# 1. 看 auth 设置
sql = "docker exec supabase-auth env | grep -i -E 'ENABLE_EMAIL|MAILER|SIGNUP|EXTERNAL'"
stdin, stdout, stderr = ssh.exec_command(sql, timeout=15)
print('=== auth env (email/signup related) ===')
print(stdout.read().decode())

# 2. 调用 auth/v1/settings 确认
import requests
r = requests.get('https://thalvior.icu/auth/v1/settings', timeout=10)
print(f'\n=== /auth/v1/settings ===\nHTTP {r.status_code}')
print(r.text[:500])

# 3. 改 .env — 可能之前改 ENABLE_EMAIL_SIGNUP 时把 provider 也关了
print('\n=== 改 .env ===')
stdin, stdout, stderr = ssh.exec_command(
    "grep -E 'ENABLE_EMAIL|ENABLE_PHONE|DISABLE_SIGNUP' /opt/supabase/docker/.env",
    timeout=10)
print('改前:', stdout.read().decode())

# 确保 ENABLE_EMAIL_SIGNUP=true (email 登录 provider)，但 DISABLE_SIGNUP=true (注册关)
# ENABLE_EMAIL_SIGNUP 控制的是 email provider 能不能用 signInWithPassword
# DISABLE_SIGNUP 控制的是 /signup 端点
stdin, stdout, stderr = ssh.exec_command(
    "sudo sed -i 's/^ENABLE_EMAIL_SIGNUP=.*/ENABLE_EMAIL_SIGNUP=true/' /opt/supabase/docker/.env && "
    "sudo grep -E 'ENABLE_EMAIL|ENABLE_PHONE|DISABLE_SIGNUP' /opt/supabase/docker/.env",
    timeout=10)
print('改后:', stdout.read().decode())

# 4. 重建 auth 容器
print('=== 重建 auth ===')
stdin, stdout, stderr = ssh.exec_command(
    "cd /opt/supabase/docker && sudo docker compose up -d auth 2>&1 | tail -5",
    timeout=60)
print(stdout.read().decode())

time.sleep(5)

# 5. 再验证 settings
r2 = requests.get('https://thalvior.icu/auth/v1/settings', timeout=10)
print(f'\n=== /auth/v1/settings (after fix) ===\nHTTP {r2.status_code}')
print(r2.text[:500])

ssh.close()
