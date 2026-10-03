-- 邮件模板体系：模板表（中英双语）+ 发送日志（去重 & 审计）
-- 设计要点：
-- 1) 模板落库，改文案不用重新发版；后台可视化编辑
-- 2) scene + lang 唯一，同一场景支持 zh/en 两套
-- 3) 正文用 ${var} 占位符（仅限 \$\{xxx\} 语法，服务端正则替换，不做任何 eval）
-- 4) 发送日志同时承担「同一场景同一收件人去重」职责，避免登录通知/额度提醒刷屏

create table if not exists public.email_templates (
  id uuid primary key default gen_random_uuid(),
  scene text not null,                    -- welcome | subscription_activated | membership_expiring | login_alert | quota_exhausted | register_code
  lang text not null default 'zh',        -- zh | en
  name text not null,
  subject text not null,
  body text not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint email_templates_scene_lang_key unique (scene, lang)
);

create table if not exists public.email_send_logs (
  id uuid primary key default gen_random_uuid(),
  scene text not null,
  recipient text not null,
  lang text not null default 'zh',
  subject text,
  render_ok boolean not null default true,
  fallback boolean not null default false,  -- 是否使用了内置兜底模板
  success boolean not null default false,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists email_send_logs_scene_recipient_idx
  on public.email_send_logs (scene, recipient, created_at desc);

alter table public.email_templates enable row level security;
alter table public.email_send_logs enable row level security;

-- 管理员可读写模板
do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'email_templates' and policyname = 'admins_manage_email_templates'
  ) then
    create policy "admins_manage_email_templates" on public.email_templates
      for all using (has_role(auth.uid(), 'admin')) with check (has_role(auth.uid(), 'admin'));
  end if;
end $$;

-- 管理员可查看发送日志（写入只走 service_role）
do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'email_send_logs' and policyname = 'admins_select_email_send_logs'
  ) then
    create policy "admins_select_email_send_logs" on public.email_send_logs
      for select using (has_role(auth.uid(), 'admin'));
  end if;
end $$;

-- ===== 默认模板（按需求方给定文案，逐字落库）=====
insert into public.email_templates (scene, lang, name, subject, body) values
('welcome', 'zh', '注册成功欢迎邮件', '欢迎使用 Thalvior 跨境ERP', $tpl$尊敬的 ${userName}：

恭喜您成功注册 Thalvior 跨境ERP系统。
您的登录账号：${account}
系统访问地址：${systemUrl}
如有任何问题，欢迎联系客服咨询。$tpl$),
('welcome', 'en', 'Welcome Email', 'Welcome to Thalvior Cross-border ERP', $tpl$Dear ${userName},

Congratulations! Your Thalvior Cross-border ERP account has been created successfully.
Login account: ${account}
System URL: ${systemUrl}
If you have any questions, feel free to contact our support team.$tpl$),

('subscription_activated', 'zh', '订阅套餐开通通知', '【Thalvior】您的会员套餐已开通成功', $tpl$尊敬的 ${userName}：

您好！
您购买的Thalvior会员套餐已成功开通。
套餐名称：${packageName}
有效期：${startDate} — ${endDate}
AI剩余可用额度：${aiTokenCount}

登录系统即可使用全部会员权益。
系统地址：${systemUrl}$tpl$),
('subscription_activated', 'en', 'Subscription Activated', '【Thalvior】Your membership plan is now active', $tpl$Dear ${userName},

Your Thalvior membership plan has been activated successfully.
Plan: ${packageName}
Validity: ${startDate} — ${endDate}
Remaining AI credits: ${aiTokenCount}

Sign in to enjoy all membership benefits.
System URL: ${systemUrl}$tpl$),

('membership_expiring', 'zh', '会员到期提醒', '【Thalvior】您的会员套餐即将到期', $tpl$尊敬的 ${userName}：

您好！
您的Thalvior会员套餐将于 ${expireDate} 到期。
套餐到期后，会员专属功能、AI额度权益将会暂停使用。

点击链接前往续费：${systemUrl}/subscription$tpl$),
('membership_expiring', 'en', 'Membership Expiring', '【Thalvior】Your membership plan is about to expire', $tpl$Dear ${userName},

Your Thalvior membership plan will expire on ${expireDate}.
After expiration, membership-only features and AI credits will be suspended.

Renew here: ${systemUrl}/subscription$tpl$),

('login_alert', 'zh', '账号登录安全通知', '【Thalvior】账号登录安全提醒', $tpl$尊敬的 ${userName}：

您好！
您的账号于 ${loginTime} 在 ${loginIp} 地址登录Thalvior系统。

如非本人操作，请立即登录系统修改密码，并联系客服冻结账号。
系统地址：${systemUrl}$tpl$),
('login_alert', 'en', 'Login Security Alert', '【Thalvior】Account login security notice', $tpl$Dear ${userName},

Your account was signed in at ${loginTime} from IP ${loginIp}.

If this was not you, please sign in and change your password immediately, and contact support to freeze the account.
System URL: ${systemUrl}$tpl$),

('quota_exhausted', 'zh', 'AI额度耗尽提醒', '【Thalvior】您的AI调用额度已耗尽', $tpl$尊敬的 ${userName}：

您好！
您账号下的AI调用额度已经全部耗尽。
额度耗尽后，AI文案润色、图片翻译等增值功能将暂时无法使用。

前往会员中心充值购买额度：${systemUrl}/subscription$tpl$),
('quota_exhausted', 'en', 'AI Credits Exhausted', '【Thalvior】Your AI credits have been used up', $tpl$Dear ${userName},

Your AI credits have been fully used up.
AI copy polishing, image translation and other value-added features will be temporarily unavailable.

Top up now: ${systemUrl}/subscription$tpl$),

('register_code', 'zh', '注册邮箱验证码', '【Thalvior】注册邮箱验证码', $tpl$尊敬的用户：

您正在注册Thalvior跨境ERP，本次验证码：${code}
验证码有效期${minutes}分钟，请尽快完成验证。
如非本人操作，请忽略此邮件。$tpl$),
('register_code', 'en', 'Registration Verification Code', '【Thalvior】Registration email verification code', $tpl$Dear user,

You are registering for Thalvior Cross-border ERP. Your verification code: ${code}
The code is valid for ${minutes} minutes. Please complete verification as soon as possible.
If this was not you, please ignore this email.$tpl$)
on conflict (scene, lang) do update set
  name = excluded.name,
  subject = excluded.subject,
  body = excluded.body,
  updated_at = now();
