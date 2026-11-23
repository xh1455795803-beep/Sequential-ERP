-- ============================================================
-- 创建 SaaS 三端 Demo 账号（Supabase auth.users）
-- Supabase 用 bcrypt，我们用 crypt() + gen_salt('bf') 生成
-- ============================================================

BEGIN;

-- 先清掉可能存在的旧账号
DELETE FROM auth.users WHERE email IN (
  'merchant1@thalvior.demo',
  'merchant2@thalvior.demo',
  'warehouse@thalvior.demo',
  'admin@thalvior.demo'
);

-- 商家 1: merchant1@thalvior.demo / 123456
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  '10000000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'merchant1@thalvior.demo',
  crypt('123456', gen_salt('bf')),
  NOW(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"merchant_id":"00000000-0000-0000-0000-000000000101","role":"merchant"}'::jsonb,
  NOW(), NOW(), NULL, NULL
);

-- 商家 2: merchant2@thalvior.demo / 123456
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  '10000000-0000-0000-0000-000000000002',
  'authenticated',
  'authenticated',
  'merchant2@thalvior.demo',
  crypt('123456', gen_salt('bf')),
  NOW(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"merchant_id":"00000000-0000-0000-0000-000000000102","role":"merchant"}'::jsonb,
  NOW(), NOW()
);

-- 仓库管理员: warehouse@thalvior.demo / 123456
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  '20000000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'warehouse@thalvior.demo',
  crypt('123456', gen_salt('bf')),
  NOW(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"warehouse_id":"00000000-0000-0000-0000-000000000001","role":"warehouse"}'::jsonb,
  NOW(), NOW()
);

-- 平台超管: super@thalvior.demo / admin123
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  '30000000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'super@thalvior.demo',
  crypt('admin123', gen_salt('bf')),
  NOW(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"role":"admin"}'::jsonb,
  NOW(), NOW()
);

-- 验证
SELECT id, email, role, raw_user_meta_data->>'role' as portal_role FROM auth.users WHERE email LIKE '%thalvior.demo%';

COMMIT;
