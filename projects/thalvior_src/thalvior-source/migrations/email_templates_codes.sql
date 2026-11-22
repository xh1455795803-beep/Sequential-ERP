-- 补「登录验证码 / 重置密码验证码」两个场景
-- 原因：验证码通道同时服务注册、登录、找回密码三个入口，
--       若登录时也套用「注册验证码」标题会很怪，因此独立成两份模板（后台可分别编辑）
insert into public.email_templates (scene, lang, name, subject, body) values
('login_code', 'zh', '登录邮箱验证码', '【Thalvior】登录邮箱验证码', $tpl$尊敬的用户：

您正在登录 Thalvior 跨境ERP，本次验证码：${code}
验证码有效期${minutes}分钟，请尽快完成验证。
如非本人操作，请忽略此邮件。$tpl$),
('login_code', 'en', 'Login Verification Code', '【Thalvior】Login email verification code', $tpl$Dear user,

You are signing in to Thalvior Cross-border ERP. Your verification code: ${code}
The code is valid for ${minutes} minutes.
If this was not you, please ignore this email.$tpl$),

('reset_code', 'zh', '重置密码邮箱验证码', '【Thalvior】重置密码邮箱验证码', $tpl$尊敬的用户：

您正在重置 Thalvior 跨境ERP 登录密码，本次验证码：${code}
验证码有效期${minutes}分钟，请尽快完成验证。
如非本人操作，请忽略此邮件。$tpl$),
('reset_code', 'en', 'Password Reset Verification Code', '【Thalvior】Password reset verification code', $tpl$Dear user,

You are resetting your Thalvior Cross-border ERP password. Your verification code: ${code}
The code is valid for ${minutes} minutes.
If this was not you, please ignore this email.$tpl$)
on conflict (scene, lang) do update set
  name = excluded.name,
  subject = excluded.subject,
  body = excluded.body,
  updated_at = now();
