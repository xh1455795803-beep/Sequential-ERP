"""
修复 nginx meoo 配置：
删除错误的 location block（alias /var/www/wms/）
/dashboard/  → 应该走 ERP SPA fallback
/merchant/   → 应该走 ERP SPA fallback
/admin/      → 应该走 ERP SPA fallback
/erp/        → 已经废弃，也走 SPA fallback

只保留正确的 /wms/ block
"""
import socket, time, paramiko

def connect():
    for attempt in range(5):
        try:
            proxy = socket.socket()
            proxy.settimeout(5)
            proxy.connect(('127.0.0.1', 18080))
            proxy.send(b'CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n')
            time.sleep(0.8)
            ssh = paramiko.SSHClient()
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            ssh.connect('43.133.232.81', username='ubuntu', password='yuan340364#', sock=proxy, timeout=10)
            return ssh, proxy
        except Exception as e:
            print(f'  Attempt {attempt+1} failed: {e}, retry in 3s...')
            time.sleep(3)
    raise Exception('All retries failed')

ssh, proxy = connect()
sftp = ssh.open_sftp()

# 1. 下载当前配置
sftp.get('/etc/nginx/sites-enabled/meoo', '/workspace/meoo_current.conf')
print('[1] downloaded meoo config')

# 2. 用 sed 删除 4 组错误 location blocks
# 每组有 2 个 block：location ^~ /xxx/ { ... } 和 location = /xxx { return 301 /xxx/; }
# 还包括 portal 的 redirect block（那个是正确的，保留）

with open('/workspace/meoo_current.conf', 'r') as f:
    lines = f.readlines()

# 找到要删除的 block
# pattern: /dashboard/, /erp/, /merchant/, /admin/
# 我们要删除：
#   location ^~ /dashboard/ { ... } + location = /dashboard { return 301 /dashboard/; }
#   location ^~ /erp/ { ... } + location = /erp { return 301 /erp/; }
#   location ^~ /merchant/ { ... } + location = /merchant { return 301 /merchant/; }
#   location ^~ /admin/ { ... } + location = /admin { return 301 /admin/; }

bad_prefixes = ['/dashboard/', '/erp/', '/merchant/', '/admin/']
bad_exacts = ['/dashboard', '/erp', '/merchant', '/admin']

result = []
skip_until_close = False
skip_until_line = None  # e.g., "location = /dashboard"

i = 0
while i < len(lines):
    line = lines[i]
    
    # 检查是否进入错误的 location ^~ /xxx/ block
    for prefix in bad_prefixes:
        if f'location ^~ {prefix}' in line:
            skip_until_close = True
            break
    
    # 检查是否是错误的 location = /xxx 单独 block
    for exact in bad_exacts:
        if f'location = {exact} {{ return 301' in line:
            # 这行自己就完成了（单行 return 301）
            skip_until_line = True
            break
    
    if skip_until_line:
        skip_until_line = False
        i += 1
        continue
    
    if skip_until_close:
        # 跳过直到下一个 } 单独一行
        if line.strip() == '}':
            skip_until_close = False
        i += 1
        continue
    
    result.append(line)
    i += 1

with open('/workspace/meoo_fixed.conf', 'w') as f:
    f.writelines(result)

print(f'[2] cleaned: {len(lines)} → {len(result)} lines')

# 3. 上传 + 应用
sftp.put('/workspace/meoo_fixed.conf', '/tmp/meoo_fixed.conf')
print('[3] uploaded fixed config')

cmd = """
sudo cp /etc/nginx/sites-enabled/meoo /etc/nginx/sites-enabled/meoo.bak.$(date +%H%M%S)
sudo cp /tmp/meoo_fixed.conf /etc/nginx/sites-enabled/meoo
sudo nginx -t 2>&1
echo ""
echo "=== reload ==="
sudo nginx -s reload 2>&1
echo "done"
echo ""
echo "=== 验证 dashboard/merchant/admin/erp 都走 SPA fallback ==="
for path in /dashboard /dashboard/ /merchant /merchant/ /admin /admin/ /erp /erp/; do
  code=$(curl -sk -o /dev/null -w '%{http_code}' https://thalvior.icu$path)
  echo "  $path → HTTP $code"
done
"""

_, stdout, stderr = ssh.exec_command(cmd, timeout=20)
print(stdout.read().decode())
if err := stderr.read().decode():
    print('STDERR:', err[:500])

# 清理备份目录里的 .bak 文件（如果被 sites-enabled 扫描的话）
cmd2 = """
sudo rm -f /etc/nginx/sites-enabled/meoo.bak.* 2>/dev/null; echo 'backup cleanup done'
"""
_, stdout, _ = ssh.exec_command(cmd2, timeout=5)

sftp.close(); ssh.close(); proxy.close()
print('[OK] nginx fixed')
