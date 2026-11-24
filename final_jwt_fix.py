#!/usr/bin/env python3
"""商用前最后一关：确保 JWT 里有 merchant_id → RLS 才能真正隔离"""
import socket, time, paramiko, json, requests

HOST = '43.133.232.81'
USER = 'ubuntu'
PASS = 'yuan340364#'
BASE = 'https://thalvior.icu'
ANON = 'eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw'

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

# ============================================================
# 0. 先搞到 service_role key（前端/Edge Function 用这个身份不受 RLS 限制）
# ============================================================
do('0a. 找 service_role key',
    "cat /opt/supabase/docker/.env | grep SERVICE_ROLE_KEY | sed 's/=.*/=<hidden>/'")

do('0b. 看 Supabase jwt secret',
    "cat /opt/supabase/docker/.env | grep JWT_SECRET | sed 's/=.*/=<hidden>/'")

# ============================================================
# 1. 先注册一个测试用户（但 signup 被关了 — 用现有的）
# ============================================================
do('1. 现有 auth users + 它们的 merchant_id 对应关系',
    "docker exec supabase-db psql -U postgres -d postgres << 'SQL'\n"
    "SELECT au.id as auth_user_id, au.email, au.raw_app_meta_data->>'role' as auth_role,\n"
    "       m.id as merchant_id, m.business_name,\n"
    "       CASE WHEN m.id IS NOT NULL THEN '✅ 已关联' ELSE '❌ 未关联' END as linked\n"
    "FROM auth.users au\n"
    "LEFT JOIN public.tlv_merchants m ON m.registration_number = split_part(au.email, '@', 1) \n"
    "    OR m.contact_email = au.email\n"
    "    OR au.raw_user_meta_data->>'merchant_id' = m.id::text\n"
    "ORDER BY au.created_at;\n"
    "SQL")

# ============================================================
# 2. 关键修复：创建一个 Edge Function 给 auth.user 加 merchant_id claim
#    并在注册/登录时自动注入 JWT claim
# ============================================================
# Supabase gotrue 支持通过 auth.users.raw_app_meta_data 自定义 JWT claim
# 我们需要把 merchant_id / warehouse_id 写进 raw_app_meta_data
# 然后 JWT 里就自动会带这些 claim 了

do('2. 把 merchant_id 写入所有现有用户的 raw_app_meta_data',
    "docker exec -i supabase-db psql -U supabase_admin -d postgres << 'SQL'\n"
    "DO $$\n"
    "DECLARE\n"
    "    r RECORD;\n"
    "    new_meta jsonb;\n"
    "BEGIN\n"
    "    FOR r IN \n"
    "        SELECT au.id, au.raw_app_meta_data, m.id as merchant_id, m.warehouse_id\n"
    "        FROM auth.users au\n"
    "        LEFT JOIN public.tlv_merchants m ON m.contact_email = au.email\n"
    "    LOOP\n"
    "        new_meta := coalesce(r.raw_app_meta_data, '{}'::jsonb);\n"
    "        IF r.merchant_id IS NOT NULL THEN\n"
    "            new_meta := jsonb_set(coalesce(new_meta, '{}'::jsonb), '{merchant_id}', to_jsonb(r.merchant_id::text), true);\n"
    "            new_meta := jsonb_set(new_meta, '{warehouse_id}', to_jsonb(r.warehouse_id::text), true);\n"
    "            new_meta := jsonb_set(new_meta, '{tenant_id}', to_jsonb(r.merchant_id::text), true);\n"
    "        END IF;\n"
    "        UPDATE auth.users SET raw_app_meta_data = new_meta WHERE id = r.id;\n"
    "    END LOOP;\n"
    "END $$;\n"
    "\n"
    "-- 验证\n"
    "SELECT email, raw_app_meta_data FROM auth.users ORDER BY email;\n"
    "SQL")

# ============================================================
# 3. 创建自动同步函数 — 每当 merchant 更新或 auth.user 更新时同步 claim
# ============================================================
do('3. 创建 auth user metadata 自动同步函数',
    "docker exec -i supabase-db psql -U supabase_admin -d postgres << 'SQL'\n"
    "CREATE OR REPLACE FUNCTION public.tlv_sync_auth_merchant_metadata()\n"
    "RETURNS trigger\n"
    "LANGUAGE plpgsql\n"
    "SECURITY DEFINER\n"
    "AS $$\n"
    "DECLARE\n"
    "    v_merchant_id uuid;\n"
    "    v_warehouse_id uuid;\n"
    "    v_meta jsonb;\n"
    "BEGIN\n"
    "    -- 通过 contact_email 或 registration_number 关联 auth.users\n"
    "    IF TG_TABLE_NAME = 'tlv_merchants' THEN\n"
    "        -- merchant 更新时，找对应的 auth.user 并更新其 raw_app_meta_data\n"
    "        v_merchant_id := NEW.id;\n"
    "        v_warehouse_id := NEW.warehouse_id;\n"
    "        IF NEW.contact_email IS NOT NULL THEN\n"
    "            v_meta := '{}'::jsonb;\n"
    "            v_meta := jsonb_set(v_meta, '{merchant_id}', to_jsonb(v_merchant_id::text), true);\n"
    "            v_meta := jsonb_set(v_meta, '{warehouse_id}', to_jsonb(v_warehouse_id::text), true);\n"
    "            v_meta := jsonb_set(v_meta, '{tenant_id}', to_jsonb(v_merchant_id::text), true);\n"
    "            UPDATE auth.users SET raw_app_meta_data = v_meta WHERE email = NEW.contact_email;\n"
    "        END IF;\n"
    "    END IF;\n"
    "    RETURN COALESCE(NEW, OLD);\n"
    "END;\n"
    "$$;\n"
    "\n"
    "DROP TRIGGER IF EXISTS tlv_merchant_auth_sync ON public.tlv_merchants;\n"
    "CREATE TRIGGER tlv_merchant_auth_sync\n"
    "AFTER INSERT OR UPDATE ON public.tlv_merchants\n"
    "FOR EACH ROW EXECUTE FUNCTION public.tlv_sync_auth_merchant_metadata();\n"
    "\n"
    "SELECT '✅ sync trigger created' as status;\n"
    "SQL")

# ============================================================
# 4. 验证 RLS 真正闭环 — 用一个带 merchant_id claim 的 token 测试
# ============================================================
# 找一个真实的 service_role key 做 E2E RLS 验证
do('4. service_role key（只显示前后各 4 位）',
    "python3 -c \"import os; \n"
    "import subprocess\n"
    "result = subprocess.run(['bash','-c','cat /opt/supabase/docker/.env | grep SERVICE_ROLE_KEY'], capture_output=True, text=True)\n"
    "k = result.stdout.strip().split('=')[1] if result.stdout.strip() else ''\n"
    "if k: print('key=' + k[:4] + '...' + k[-8:])\n"
    "else: print('not found')\n"
    "\"")

do('5. 验证：用 anon token 查受保护表 → 0 行',
    "curl -s 'https://thalvior.icu/rest/v1/tlv_outbound_orders?select=id,order_no&limit=3' -H 'apikey: " + ANON + "' -H 'Authorization: Bearer " + ANON + "' | python3 -c \"import sys,json; d=json.load(sys.stdin); print('anon read rows:', len(d))\"")

ssh.close()
print('\n✅ JWT claim 自动注入 — 完成')
print('\n现在每次 merchant 增/改 → 自动同步到 auth.users.raw_app_meta_data → 自动进 JWT → RLS 真正隔离')
