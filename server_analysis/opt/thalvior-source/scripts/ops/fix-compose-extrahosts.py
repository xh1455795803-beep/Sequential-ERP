import shutil, time, yaml

p = "/opt/supabase/docker/docker-compose.yml"
shutil.copy(p, p + ".bak-eh-" + str(int(time.time())))
lines = open(p, encoding="utf-8").read().split("\n")

# 删除误插在 environment 中间的 extra_hosts 段
try:
    start = lines.index("    extra_hosts:")
    end = start + 1
    while end < len(lines) and lines[end].strip().startswith('- "smtp.qq.com:'):
        end += 1
    del lines[start:end]
except ValueError:
    pass

# 在 auth 服务的 environment: 之前插入
env_i = lines.index("    environment:", 100)
block = [
    "    extra_hosts:",
    '      - "smtp.qq.com:43.129.255.54"',
    '      - "smtp.qq.com:43.163.178.76"',
]
lines[env_i:env_i] = block
open(p, "w", encoding="utf-8").write("\n".join(lines))

d = yaml.safe_load(open(p, encoding="utf-8"))
print("YAML OK · auth.extra_hosts =", d["services"]["auth"].get("extra_hosts"))
