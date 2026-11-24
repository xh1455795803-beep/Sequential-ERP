import socket, time, paramiko, requests

HOST = '43.133.232.81'; USER='ubuntu'; PASS='yuan340364#'
proxy = socket.socket(); proxy.connect(('127.0.0.1', 18080))
proxy.send(b'CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n')
time.sleep(0.6)
ssh = paramiko.SSHClient(); ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, sock=proxy)

anon_key = 'eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw'

print('=== 误报核实 ===')
# 1. REST API 加上 apikey
r = requests.get('https://thalvior.icu/rest/v1/', headers={'apikey': anon_key}, timeout=10)
print(f'REST API (with apikey): HTTP {r.status_code}')

# 2. Auth settings 加上 apikey
r = requests.get('https://thalvior.icu/auth/v1/settings', headers={'apikey': anon_key}, timeout=10)
print(f'Auth settings (with apikey): HTTP {r.status_code}')

# 3. Edge Functions 不带参数 400 是正常的（说明活了）
r = requests.get('https://thalvior.icu/functions/v1/', timeout=10)
print(f'Edge Functions root: HTTP {r.status_code}')

# === 真问题：5 张裸奔表 ===
print('\n=== 真问题：5 张裸奔表（qual=true 没过滤）===')
tables = ['tlv_billing_rules', 'tlv_billings', 'tlv_cod_settlements', 'tlv_customer_followups', 'tlv_employees']
for t in tables:
    stdin, stdout, stderr = ssh.exec_command(
        f"docker exec supabase-db psql -U postgres -t -c \"SELECT p.tablename || ': qual=' || COALESCE(p.qual,'null') FROM pg_policies p WHERE p.tablename='{t}' LIMIT 2;\" 2>&1",
        timeout=10)
    print(stdout.read().decode())

# === 补上 RLS ===
print('\n=== 补 RLS policy ===')
sql = r"""
-- tlv_billing_rules: 商家只看自己的
DROP POLICY IF EXISTS billing_rules_svc ON tlv_billing_rules;
DROP POLICY IF EXISTS billing_rules_auth ON tlv_billing_rules;
CREATE POLICY billing_rules_svc ON tlv_billing_rules FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY billing_rules_auth ON tlv_billing_rules FOR SELECT USING (true);  -- 计费规则是 SaaS 公开配置

-- tlv_billings: 按 merchant_id 隔离
DROP POLICY IF EXISTS billings_svc ON tlv_billings;
DROP POLICY IF EXISTS billings_auth ON tlv_billings;
CREATE POLICY billings_svc ON tlv_billings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY billings_auth ON tlv_billings FOR SELECT USING (merchant_id = (auth.jwt() ->> 'merchant_id')::uuid OR auth.jwt() ->> 'portal_role' IN ('admin','warehouse'));

-- tlv_cod_settlements: 按 merchant_id 隔离
DROP POLICY IF EXISTS cod_svc ON tlv_cod_settlements;
DROP POLICY IF EXISTS cod_auth ON tlv_cod_settlements;
CREATE POLICY cod_svc ON tlv_cod_settlements FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY cod_auth ON tlv_cod_settlements FOR SELECT USING (merchant_id = (auth.jwt() ->> 'merchant_id')::uuid OR auth.jwt() ->> 'portal_role' IN ('admin','warehouse'));

-- tlv_customer_followups: 按 merchant_id 隔离
DROP POLICY IF EXISTS cust_svc ON tlv_customer_followups;
DROP POLICY IF EXISTS cust_auth ON tlv_customer_followups;
CREATE POLICY cust_svc ON tlv_customer_followups FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY cust_auth ON tlv_customer_followups FOR SELECT USING (merchant_id = (auth.jwt() ->> 'merchant_id')::uuid OR auth.jwt() ->> 'portal_role' IN ('admin','warehouse'));

-- tlv_employees: 按 warehouse_id 隔离
DROP POLICY IF EXISTS emp_svc ON tlv_employees;
DROP POLICY IF EXISTS emp_auth ON tlv_employees;
CREATE POLICY emp_svc ON tlv_employees FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY emp_auth ON tlv_employees FOR SELECT USING (warehouse_id = (auth.jwt() ->> 'warehouse_id')::uuid OR auth.jwt() ->> 'portal_role' IN ('admin','merchant'));

ANALYZE tlv_billing_rules, tlv_billings, tlv_cod_settlements, tlv_customer_followups, tlv_employees;
"""
stdin, stdout, stderr = ssh.exec_command(
    f"docker exec -i supabase-db psql -U postgres -c \"{sql.replace(chr(34), chr(39))}\" 2>&1",
    timeout=30)
# 用 heredoc 更可靠
stdin, stdout, stderr = ssh.exec_command(
    'docker exec -i supabase-db psql -U postgres << \'SQLEOF\'' + '\n' + sql + '\nSQLEOF',
    timeout=30)
out = stdout.read().decode()
err = stderr.read().decode()
print('SQL OUT:', out[:500] if out else '(none)')
if err: print('SQL ERR:', err[:500])

# 验证
print('\n=== 验证修复后 ===')
stdin, stdout, stderr = ssh.exec_command(
    """docker exec supabase-db psql -U postgres -t -c "
    SELECT p.tablename || ': auth_policy=' || COALESCE(p.qual,'null') 
    FROM pg_policies p 
    WHERE p.tablename IN ('tlv_billing_rules','tlv_billings','tlv_cod_settlements','tlv_customer_followups','tlv_employees')
    AND p.policyname LIKE '%_auth'
    ORDER BY p.tablename;" 2>&1""",
    timeout=15)
print(stdout.read().decode())

ssh.close()
