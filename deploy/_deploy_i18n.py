#!/usr/bin/env python3
"""部署 i18n 全面翻译: 上传改造页面 + 页字典 + 三个主字典, npm run build, 校验"""
import socket, os, sys, json
from urllib.parse import urlparse
import paramiko

HOST = "43.133.232.81"
USER, PWD = "root", "yuan340364"
PROXY_URL = (os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy')
             or os.environ.get('HTTP_PROXY') or os.environ.get('http_proxy'))

FILES = [
    "pages/Dashboard.tsx",
    "pages/OrderList.tsx",
    "pages/ProductList.tsx",
    "pages/ProductEdit.tsx",
    "pages/InventoryList.tsx",
    "pages/ShopList.tsx",
    "pages/FinanceList.tsx",
    "pages/SystemSettings.tsx",
    "i18n/pages/zh-CN.ts",
    "i18n/pages/en-US.ts",
    "i18n/pages/ja-JP.ts",
    "i18n/locales/zh-CN.ts",
    "i18n/locales/en-US.ts",
    "i18n/locales/ja-JP.ts",
    "i18n/types.ts",
]
ROOT = "/opt/thalvior/miaoerp"

def connect():
    p = urlparse(PROXY_URL)
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(20)
    s.connect((p.hostname, p.port or 80))
    s.sendall(f'CONNECT {HOST}:22 HTTP/1.1\r\nHost: {HOST}:22\r\n\r\n'.encode())
    data = b''
    while b'\r\n\r\n' not in data:
        data += s.recv(1)
        if len(data) > 4096: break
    if '200' not in data.split(b'\r\n')[0].decode(errors='ignore'):
        raise RuntimeError('CONNECT 非200')
    cli = paramiko.SSHClient()
    cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    cli.connect(hostname=HOST, port=22, username=USER, password=PWD, sock=s,
                timeout=25, banner_timeout=20, auth_timeout=20,
                allow_agent=False, look_for_keys=False)
    return cli

def run(cli, cmd, timeout=40):
    _, so, se = cli.exec_command(cmd, timeout=timeout)
    return so.read().decode("utf-8","replace"), se.read().decode("utf-8","replace")

cli = connect()
sftp = cli.open_sftp()
print(f"[OK] 连接 {HOST}")

# 确保远端目录存在
run(cli, f"mkdir -p {ROOT}/src/i18n/pages")

ok = True
for rel in FILES:
    local = f"/workspace/thalvior-src/{rel}"
    remote = f"{ROOT}/src/{rel}"
    sftp.put(local, remote)
    with open(local,'rb') as f: L = f.read()
    with sftp.open(remote,'rb') as f: R = f.read()
    same = (L == R)
    ok = ok and same
    print(f"  {'OK ' if same else 'BAD'} {rel} ({len(L)}b)")

if not ok:
    print("[ERR] 上传不一致, 中止构建")
    sys.exit(1)

print("  开始 npm run build ...")
out, err = run(cli, f"cd {ROOT} && npm run build 2>&1 | tail -50", timeout=600)
print(out.strip() or "(空)")
if err.strip(): print("[stderr]", err.strip())
print("[DONE]")