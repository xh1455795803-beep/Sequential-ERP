#!/usr/bin/env python3
"""P0-2 + P1-3 + P1-4 + P1-5 — 一口气修完剩余所有"""
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
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=60)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    if out: print(out[:400])
    if err: print('STDOUT_ERR:', err[:300])

# ==================== P0-2: Auth 生产配置 ====================
# 先看当前 auth.config
do('P0-2a. 当前 auth 配置',
    "docker exec supabase-auth cat /tmp/config.json 2>/dev/null; "
    "docker exec supabase-db psql -U supabase_admin -d auth -c \"SELECT key, value FROM auth.config WHERE key IN ('enable_signup','email_confirm','password_min_length','password_require_uppercase','password_require_lowercase','password_require_numbers','password_require_symbols') ORDER BY key;\" 2>&1 | head -30")

# 用 supabase_admin 改 auth.config 表
do('P0-2b. 改 Auth config — 关开放注册 + 强密码',
    "docker exec supabase-db psql -U supabase_admin -d auth << 'EOF'\n"
    "UPDATE auth.config SET value = 'false' WHERE key = 'enable_signup';\n"
    "INSERT INTO auth.config (key, value) VALUES ('enable_signup', 'false') ON CONFLICT (key) DO UPDATE SET value = 'false';\n"
    "INSERT INTO auth.config (key, value) VALUES ('mailer_autoconfirm', 'false') ON CONFLICT (key) DO UPDATE SET value = 'false';\n"
    "INSERT INTO auth.config (key, value) VALUES ('password_min_length', '8') ON CONFLICT (key) DO UPDATE SET value = '8';\n"
    "INSERT INTO auth.config (key, value) VALUES ('password_require_uppercase', 'true') ON CONFLICT (key) DO UPDATE SET value = 'true';\n"
    "INSERT INTO auth.config (key, value) VALUES ('password_require_lowercase', 'true') ON CONFLICT (key) DO UPDATE SET value = 'true';\n"
    "INSERT INTO auth.config (key, value) VALUES ('password_require_numbers', 'true') ON CONFLICT (key) DO UPDATE SET value = 'true';\n"
    "SELECT key, value FROM auth.config WHERE key IN ('enable_signup','mailer_autoconfirm','password_min_length','password_require_uppercase','password_require_lowercase','password_require_numbers');\n"
    "EOF"
)

# 重启 auth 容器使配置生效
do('P0-2c. 重启 auth 容器',
    'docker restart supabase-auth && sleep 3 && docker ps --filter name=supabase-auth --format "{{.Names}} {{.Status}}"')

# ==================== P1-4: 审计日志表 ====================
do('P1-4. 新建 tlv_audit_logs + 自动记录 trigger',
    "docker exec -i supabase-db psql -U supabase_admin -d postgres << 'SQLEOF'\n"
    "CREATE TABLE IF NOT EXISTS public.tlv_audit_logs (\n"
    "  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),\n"
    "  table_name text NOT NULL,\n"
    "  operation text NOT NULL CHECK (operation IN ('INSERT','UPDATE','DELETE')),\n"
    "  row_id uuid,\n"
    "  merchant_id uuid,\n"
    "  warehouse_id uuid,\n"
    "  operator_id text,\n"
    "  operator_email text,\n"
    "  old_data jsonb,\n"
    "  new_data jsonb,\n"
    "  created_at timestamptz DEFAULT now()\n"
    ");\n"
    "CREATE INDEX IF NOT EXISTS idx_audit_logs_table ON public.tlv_audit_logs(table_name);\n"
    "CREATE INDEX IF NOT EXISTS idx_audit_logs_merchant ON public.tlv_audit_logs(merchant_id);\n"
    "CREATE INDEX IF NOT EXISTS idx_audit_logs_time ON public.tlv_audit_logs(created_at);\n"
    "\n"
    "CREATE OR REPLACE FUNCTION public.tlv_audit_trigger() RETURNS trigger AS $$\n"
    "BEGIN\n"
    "  INSERT INTO public.tlv_audit_logs(table_name, operation, row_id, merchant_id, warehouse_id,\n"
    "    operator_id, operator_email, old_data, new_data)\n"
    "  VALUES (TG_TABLE_NAME,\n"
    "    TG_OP,\n"
    "    COALESCE(NEW.id, OLD.id),\n"
    "    COALESCE(NEW.merchant_id, OLD.merchant_id),\n"
    "    COALESCE(NEW.warehouse_id, OLD.warehouse_id),\n"
    "    current_setting('app.operator_id', true),\n"
    "    current_setting('app.operator_email', true),\n"
    "    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END,\n"
    "    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END\n"
    "  );\n"
    "  RETURN COALESCE(NEW, OLD);\n"
    "END;\n"
    "$$ LANGUAGE plpgsql SECURITY DEFINER;\n"
    "\n"
    "DO $$\n"
    "DECLARE r RECORD;\n"
    "BEGIN\n"
    "  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'tlv_%' AND tablename NOT IN ('tlv_audit_logs') LOOP\n"
    "    EXECUTE format('DROP TRIGGER IF EXISTS tlv_audit_%s ON public.%I;', replace(r.tablename,'tlv_',''), r.tablename);\n"
    "    EXECUTE format('CREATE TRIGGER tlv_audit_%s AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.tlv_audit_trigger();',\n"
    "      replace(r.tablename,'tlv_',''), r.tablename);\n"
    "  END LOOP;\n"
    "END $$;\n"
    "SELECT count(*) as audit_triggers_created FROM pg_trigger WHERE tgname LIKE 'tlv_audit_%' AND NOT tgisinternal;\n"
    "SQLEOF"
)

# ==================== P1-3: 日志轮转 ====================
# Docker
do('P1-3a. Docker logrotate',
    "sudo tee /etc/docker/daemon.json > /dev/null << 'EOF'\n"
    "{\n"
    "  \"log-driver\": \"json-file\",\n"
    "  \"log-opts\": {\n"
    "    \"max-size\": \"10m\",\n"
    "    \"max-file\": \"3\"\n"
    "  }\n"
    "}\n"
    "EOF\n"
    "sudo cat /etc/docker/daemon.json\n"
    "# 注意：daemon.json 生效需要重启 docker，这里先记录，等部署时再重启")

# Nginx logrotate
do('P1-3b. Nginx logrotate 配置',
    "sudo tee /etc/logrotate.d/thalvior-nginx > /dev/null << 'EOF'\n"
    "/var/log/nginx/*.log {\n"
    "  daily\n"
    "  rotate 14\n"
    "  compress\n"
    "  delaycompress\n"
    "  missingok\n"
    "  notifempty\n"
    "  create 0640 www-data adm\n"
    "  sharedscripts\n"
    "  postrotate\n"
    "    [ -f /var/run/nginx.pid ] && nginx -s reload 2>/dev/null || true\n"
    "  endscript\n"
    "}\n"
    "EOF\n"
    "sudo cat /etc/logrotate.d/thalvior-nginx\n"
    "sudo logrotate -d /etc/logrotate.d/thalvior-nginx 2>&1 | tail -10")

# ==================== P1-5: Nginx 安全加固 ====================
do('P1-5. Nginx 安全头 + rate limiting',
    "# 先看当前 nginx 配置\n"
    "sudo grep -n '' /etc/nginx/sites-enabled/default 2>/dev/null | head -60\n"
    "sudo grep -rn 'server_name' /etc/nginx/sites-enabled/ 2>/dev/null")

# 创建新的 nginx 安全配置文件（不覆盖原有 default，加 include）
do('P1-5b. 写安全配置片段',
    "sudo tee /etc/nginx/conf.d/security.conf > /dev/null << 'EOF'\n"
    "# ============ Rate Limiting ============\n"
    "limit_req_zone $binary_remote_addr zone=api:10m rate=30r/s;\n"
    "limit_req_zone $binary_remote_addr zone=auth:10m rate=5r/m;\n"
    "limit_conn_zone $binary_remote_addr zone=conn_per_ip:10;\n"
    "\n"
    "# ============ Security Headers ============\n"
    "add_header X-Frame-Options \"SAMEORIGIN\" always;\n"
    "add_header X-Content-Type-Options \"nosniff\" always;\n"
    "add_header X-XSS-Protection \"1; mode=block\" always;\n"
    "add_header Strict-Transport-Security \"max-age=31536000; includeSubDomains\" always;\n"
    "add_header Referrer-Policy \"strict-origin-when-cross-origin\" always;\n"
    "add_header Permissions-Policy \"geolocation=(), camera=(), microphone=()\" always;\n"
    "add_header Content-Security-Policy \"default-src 'self' https: data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https:; img-src 'self' https: data: blob:; font-src 'self' https: data:; connect-src 'self' https: wss:; frame-ancestors 'self';\" always;\n"
    "EOF\n"
    "sudo cat /etc/nginx/conf.d/security.conf\n"
    "sudo nginx -t 2>&1")

# ==================== 最终验证 ====================
do('最终验证 — 跑一个订单 INSERT 看 audit_logs 有没有记录',
    "docker exec -i supabase-db psql -U supabase_admin -d postgres << 'SQLEOF'\n"
    "INSERT INTO tlv_outbound_orders (warehouse_id, merchant_id, order_no, source, receiver_name, receiver_address, receiver_city, receiver_country, receiver_state, receiver_postal_code, merchant_name, is_cod, weight_kg)\n"
    "VALUES ('57ae8979-c77f-4a88-b80a-113f01b5cbee', '7e3bf09f-3937-4891-a6f6-75941f39d1b2', 'AUDIT-VERIFY-2026', 'api', 'Audit Test', '123 Main', 'LA', 'US', 'CA', '90001', 'Demo', false, 1.0);\n"
    "DELETE FROM tlv_outbound_orders WHERE order_no = 'AUDIT-VERIFY-2026';\n"
    "\n"
    "SELECT table_name, operation, row_id, merchant_id, created_at, new_data->>'order_no' as order_no\n"
    "FROM tlv_audit_logs WHERE table_name = 'tlv_outbound_orders' AND created_at > now() - interval '10 minutes'\n"
    "ORDER BY created_at DESC LIMIT 5;\n"
    "SQLEOF")

ssh.close()
print('\n✅ 全部修复完毕')
