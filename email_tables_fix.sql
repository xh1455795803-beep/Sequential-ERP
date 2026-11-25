-- 邮箱系统三张表 + 模板
CREATE TABLE IF NOT EXISTS public.email_templates (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scene       text NOT NULL,
    lang        text NOT NULL DEFAULT 'zh',
    name        text,
    subject     text NOT NULL,
    body        text NOT NULL,
    enabled     boolean NOT NULL DEFAULT true,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE(scene, lang)
);

CREATE TABLE IF NOT EXISTS public.email_codes (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email       text NOT NULL,
    scene       text NOT NULL,
    code_hash   text,
    expires_at  timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_codes_email_scene_idx ON public.email_codes(email, scene);
CREATE INDEX IF NOT EXISTS email_codes_created_at_idx ON public.email_codes(created_at);

CREATE TABLE IF NOT EXISTS public.email_send_logs (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scene        text NOT NULL,
    recipient    text NOT NULL,
    lang         text NOT NULL DEFAULT 'zh',
    subject      text,
    body_preview text,
    render_vars  jsonb,
    unresolved   text[],
    success      boolean NOT NULL DEFAULT true,
    error        text,
    fallback     boolean NOT NULL DEFAULT false,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_send_logs_scene_recipient_idx ON public.email_send_logs(scene, recipient);
CREATE INDEX IF NOT EXISTS email_send_logs_created_at_idx ON public.email_send_logs(created_at);

-- 模板（关键：login_code / reset_code 必须存在，否则 mailer fallback 返回空 body）
INSERT INTO public.email_templates (scene, lang, name, subject, body) VALUES
('login_code',    'zh', '登录邮箱验证码',     '【Thalvior】登录邮箱验证码',
 '尊敬的用户：

您正在登录 Thalvior 跨境 ERP，本次验证码：${code}
验证码有效期${minutes}分钟，请尽快完成验证。
如非本人操作，请忽略此邮件。'),
('login_code',    'en', 'Login Code',          'Thalvior Login Code',
 'Dear user, your login code: ${code} (valid ${minutes} min). Ignore if not you.'),
('reset_code',    'zh', '重置密码邮箱验证码', '【Thalvior】重置密码邮箱验证码',
 '尊敬的用户：

您正在重置 Thalvior 登录密码，本次验证码：${code}
有效期${minutes}分钟。如非本人操作请忽略。'),
('reset_code',    'en', 'Reset Code',          'Thalvior Password Reset',
 'Your reset code: ${code} (valid ${minutes} min). Ignore if not you.'),
('register_code', 'zh', '注册邮箱验证码',     '【Thalvior】注册邮箱验证码',
 '尊敬的用户：恭喜您注册 Thalvior！验证码：${code} 有效期${minutes}分钟。'),
('register_code', 'en', 'Register Code',       'Thalvior Registration',
 'Your registration code: ${code} (valid ${minutes} min).')
ON CONFLICT (scene, lang) DO UPDATE SET
    name = EXCLUDED.name, subject = EXCLUDED.subject, body = EXCLUDED.body,
    updated_at = now();
