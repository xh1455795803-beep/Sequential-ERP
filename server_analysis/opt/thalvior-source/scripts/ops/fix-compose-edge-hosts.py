import shutil, time, yaml

p = "/opt/supabase/docker/docker-compose.yml"
shutil.copy(p, p + ".bak-eh2-" + str(int(time.time())))
d = yaml.safe_load(open(p, encoding="utf-8"))

# 容器内 DNS 对 smtp.qq.com 返回 IPv6，Docker bridge 不支持 IPv6 导致连接失败且无日志。
# 为需要外发邮件的服务把解析钉到 IPv4。
HOSTS = ["smtp.qq.com:43.129.255.54", "smtp.qq.com:43.163.178.76"]
for svc in ("supabase-edge-functions",):
    key = None
    for name, cfg in d["services"].items():
        if cfg.get("container_name") == svc:
            key = name
            break
    if not key:
        print("未找到服务", svc)
        continue
    eh = d["services"][key].get("extra_hosts") or []
    for h in HOSTS:
        if h not in eh:
            eh.append(h)
    d["services"][key]["extra_hosts"] = eh
    print(f"{svc} extra_hosts = {eh}")

open(p, "w", encoding="utf-8").write(yaml.safe_dump(d, sort_keys=False, allow_unicode=True))
print("已写回 docker-compose.yml")
