#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""诊断502错误：查看服务日志、进程、端口、语法"""
import paramiko
import os
import sys

# 服务器信息
HOST = "120.55.6.75"
PORT = 22
USER = "admin"
PASS = "yuan340364"

# 代理设置
proxy_env = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy") or os.environ.get("ALL_PROXY") or ""

def build_sock():
    if proxy_env and "://" in proxy_env:
        # 解析 HTTP CONNECT 代理
        proxy_url = proxy_env.split("://", 1)[1].rstrip("/")
        auth = None
        if "@" in proxy_url:
            auth, proxy_url = proxy_url.rsplit("@", 1)
        host_port = proxy_url.split(":", 1)
        proxy_host = host_port[0]
        proxy_port = int(host_port[1]) if len(host_port) > 1 else 8080
        print(f"[SSH] 通过HTTP CONNECT隧道: {proxy_host}:{proxy_port}")
        from paramiko.proxy import ProxyCommand
        proxy_cmd = f"nc -X connect -x {proxy_host}:{proxy_port} %h %p"
        return ProxyCommand(proxy_cmd)
    return None

def run(ssh, cmd, timeout=30):
    print(f"\n>>> $ {cmd}")
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    if out.strip():
        print(out)
    if err.strip():
        print("[STDERR]", err)
    return out, err

def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    sock = build_sock()
    kwargs = dict(hostname=HOST, port=PORT, username=USER, password=PASS, timeout=15)
    if sock:
        kwargs["sock"] = sock
    ssh.connect(**kwargs)
    print("[SSH] 连接成功\n")

    # 1. 服务状态
    print("=" * 60)
    print("1. systemctl 服务状态")
    print("=" * 60)
    run(ssh, "sudo systemctl status shuxu-erp --no-pager -l -n 30")

    # 2. 详细日志
    print("\n" + "=" * 60)
    print("2. journalctl 详细日志（最近100行）")
    print("=" * 60)
    run(ssh, "sudo journalctl -u shuxu-erp --no-pager -n 100 --no-hostname")

    # 3. Node进程
    print("\n" + "=" * 60)
    print("3. Node 进程 & 端口占用")
    print("=" * 60)
    run(ssh, "ps aux | grep -E 'node|npm' | grep -v grep")
    run(ssh, "sudo netstat -tlnp 2>/dev/null | grep -E '8090|3000' || ss -tlnp | grep -E '8090|3000'")

    # 4. 语法检查
    print("\n" + "=" * 60)
    print("4. 后端核心文件语法检查")
    print("=" * 60)
    run(ssh, "cd /opt/shuxu-erp/backend && ls -la node_modules/multer node_modules/dotenv 2>&1 | head -5")
    run(ssh, "cd /opt/shuxu-erp/backend && node --check src/app.js 2>&1")
    for f in ["scheduler.js", "routes/billing.js", "routes/media.js", "routes/public-landing.js",
              "routes/saas-admin.js", "routes/saas-tenants.js"]:
        run(ssh, f"cd /opt/shuxu-erp/backend && node --check src/{f} 2>&1")

    # 5. 直接手动启动看错误
    print("\n" + "=" * 60)
    print("5. 手动启动后端（5秒超时看错误输出）")
    print("=" * 60)
    run(ssh, "cd /opt/shuxu-erp/backend && timeout 8 node src/app.js 2>&1; echo EXIT=$?", timeout=15)

    # 6. Nginx 配置
    print("\n" + "=" * 60)
    print("6. Nginx 配置与状态")
    print("=" * 60)
    run(ssh, "sudo nginx -t 2>&1")
    run(ssh, "cat /etc/nginx/conf.d/shuxu-erp.conf 2>/dev/null | head -80")
    run(ssh, "sudo systemctl status nginx --no-pager -n 10")

    # 7. 直接 curl 后端
    print("\n" + "=" * 60)
    print("7. 直接访问本机后端")
    print("=" * 60)
    run(ssh, "curl -sS -m 5 http://127.0.0.1:8090/api/health 2>&1 || echo FAIL")

    ssh.close()

if __name__ == "__main__":
    main()
