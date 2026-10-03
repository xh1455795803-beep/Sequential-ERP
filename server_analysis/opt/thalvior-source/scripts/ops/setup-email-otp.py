"""在服务器上完成 email-otp 依赖的两件事：建表 + 给 functions 服务注入 SMTP 环境变量。"""
import os
# 敏感凭证一律从环境变量注入，禁止硬编码
MAIL_PASSWORD = os.environ.get("MAIL_PASSWORD", "")
SSH_PASSWORD = os.environ.get("SSH_PASSWORD", "")
import shutil, time, yaml, subprocess

COMPOSE = "/opt/supabase/docker/docker-compose.yml"

# ---------- 1) 建 email_codes 表（仅 service_role 可访问，前端不可读写）----------
SQL = """
create table if not exists public.email_codes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  code_hash text not null,
  scene text not null default 'login',
  expires_at timestamptz not null,
  used boolean not null default false,
  attempts int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists email_codes_lookup_idx on public.email_codes (email, scene, created_at desc);
alter table public.email_codes enable row level security;
drop policy if exists "service_role only" on public.email_codes;
"""
open("/tmp/email_codes.sql", "w").write(SQL)
r = subprocess.run(
    ["sudo", "-n", "docker", "exec", "-i", "supabase-db", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"],
    input=SQL, capture_output=True, text=True,
)
print("建表:", r.returncode == 0, (r.stdout or r.stderr).strip()[-200:])

# ---------- 2) functions 服务注入 SMTP 环境变量 ----------
shutil.copy(COMPOSE, COMPOSE + ".bak-smtp2-" + str(int(time.time())))
d = yaml.safe_load(open(COMPOSE, encoding="utf-8"))
env_add = {
    "SMTP_HOST": "smtp.qq.com",
    "SMTP_PORT": "465",
    "SMTP_USER": "thalvior@foxmail.com",
    "SMTP_PASS": MAIL_PASSWORD,
    "SMTP_FROM": "thalvior@foxmail.com",
    "SMTP_FROM_NAME": "Thalvior ERP",
}
env = d["services"]["functions"].get("environment") or {}
if isinstance(env, list):
    env = dict(e.split("=", 1) for e in env)
env.update(env_add)
d["services"]["functions"]["environment"] = env
open(COMPOSE, "w", encoding="utf-8").write(yaml.safe_dump(d, sort_keys=False, allow_unicode=True))
print("functions SMTP 环境变量已写入:", list(env_add))
