#!/usr/bin/env python3
"""给 mailer 注入服务端共享密钥 MAILER_SECRET（Kong 会改写 Authorization/apikey，必须走自定义 header）。"""
import re
import secrets
import subprocess
import yaml

ENV_PATH = "/opt/supabase/docker/.env"
COMPOSE_PATH = "/opt/supabase/docker/docker-compose.yml"


def main() -> None:
    secret = secrets.token_hex(24)

    # 1) 写进 .env（compose 会用它替换 ${MAILER_SECRET} 模板变量）
    with open(ENV_PATH) as f:
        env_text = f.read()
    if re.search(r"^MAILER_SECRET=.*$", env_text, flags=re.M):
        env_text = re.sub(r"^MAILER_SECRET=.*$", f"MAILER_SECRET={secret}", env_text, flags=re.M)
    else:
        if not env_text.endswith("\n"):
            env_text += "\n"
        env_text += f"\n# 邮件服务内部调用密钥（Edge Function mailer 专用，勿外泄）\nMAILER_SECRET={secret}\n"
    with open(ENV_PATH, "w") as f:
        f.write(env_text)
    print(f"[1/3] 已写入 .env: MAILER_SECRET={secret[:8]}...({len(secret)} 字符)")

    # 2) 注入 compose 的 functions 服务 environment
    with open(COMPOSE_PATH) as f:
        file_data = f.read()

    if "MAILER_SECRET" in file_data and re.search(r"^\s+MAILER_SECRET:", file_data, flags=re.M):
        print("[2/3] compose 中已存在 MAILER_SECRET，跳过插入")
    else:
        lines = file_data.split("\n")
        out = []
        in_target = False
        target = None
        svc_re = re.compile(r"^\s{2}(functions):\s*$")
        next_svc_re = re.compile(r"^\s{2}[a-zA-Z0-9_-]+:\s*$")
        last_env_idx = -1
        env_indent = None

        # functions 的 environment 是 mapping 形式，找到最后一个 SMTP_* 成员作为锚点
        for i, ln in enumerate(lines):
            if svc_re.match(ln):
                in_target = True
                target = "functions"
                out.append(ln)
                continue
            if in_target and next_svc_re.match(ln):
                in_target = False
            if in_target:
                m = re.match(r"^(\s+)SMTP_[A-Z_]+:", ln)
                if m:
                    env_indent = m.group(1)
                    last_env_idx = i
            out.append(ln)

        if env_indent is None or last_env_idx < 0:
            raise SystemExit("未能定位 functions.environment 的 SMTP_* 成员，请人工检查")

        insert_at = last_env_idx + 1
        lines = out
        lines.insert(insert_at, f"{env_indent}MAILER_SECRET: ${{MAILER_SECRET}}")
        with open(COMPOSE_PATH, "w") as f:
            f.write("\n".join(lines))
        print(f"[2/3] 已注入 services.{target}.environment.MAILER_SECRET（缩进层 {len(env_indent)}）")

    # 3) 校验 YAML + functions 环境变量解析结果
    with open(COMPOSE_PATH) as f:
        parsed = yaml.safe_load(f)
    env_raw = parsed["services"]["functions"]["environment"]
    has = False
    if isinstance(env_raw, dict):
        has = "MAILER_SECRET" in env_raw
    else:
        has = any(str(x).startswith("MAILER_SECRET") for x in env_raw)
    print(f"[3/3] YAML 校验通过；functions 含 MAILER_SECRET={has}")

    subprocess.run(
        ["docker", "compose", "-f", COMPOSE_PATH, "config", "--services"],
        cwd="/opt/supabase/docker",
        check=True,
        capture_output=True,
    )
    print("compose config 校验通过")


if __name__ == "__main__":
    main()
