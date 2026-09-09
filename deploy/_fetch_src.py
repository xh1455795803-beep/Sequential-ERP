#!/usr/bin/env python3
"""SFTP 拉取 thalvior 前端源码 layouts/menu 等关键目录到本地，评估妙手1:1改造点"""
import sys, socket, os, io, tarfile
from urllib.parse import urlparse
import paramiko

HOST = "43.133.232.81"
USER, PWD = "root", "yuan340364"
PROXY_URL = (os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy')
             or os.environ.get('HTTP_PROXY') or os.environ.get('http_proxy'))
REMOTE = "/opt/thalvior/miaoerp/src"
LOCAL = "/workspace/thalvior-src"

def connect():
    p = urlparse(PROXY_URL)
    ph, pp = p.hostname, p.port or 80
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(20)
    s.connect((ph, pp))
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

def recv_dir(sftp, remote, local):
    os.makedirs(local, exist_ok=True)
    for e in sftp.listdir_attr(remote):
        name = e.filename
        if name in ('.','..','node_modules'): continue
        r = f"{remote}/{name}"; l = os.path.join(local, name)
        import stat as _s
        if _s.S_ISDIR(e.st_mode):
            recv_dir(sftp, r, l)
        elif _s.S_ISREG(e.st_mode):
            try: sftp.get(r, l)
            except Exception as ex: print(f"  skip {r}: {ex}")

try:
    cli = connect()
    sftp = cli.open_sftp()
    print(f"[OK] 拉取 {REMOTE} → {LOCAL}")
    recv_dir(sftp, REMOTE, LOCAL)
    # 也拉只读配置文件用于理解
    for cf in ["/opt/thalvior/miaoerp/vite.config.ts", "/opt/thalvior/miaoerp/index.html", "/opt/thalvior/miaoerp/package.json"]:
        try:
            localf = "/workspace/thalvior-src/_meta_" + os.path.basename(cf)
            sftp.get(cf, localf)
        except Exception as ex:
            print(f"  meta skip {cf}: {ex}")
    sftp.close(); cli.close()
    # 统计
    total = 0
    for root, dirs, files in os.walk(LOCAL):
        total += sum(len(os.path.join(root,f).split()) for f in files if f.endswith(('.tsx','.ts','.css')))
    print(f"[OK] 完成。源码文件数(含子目录): 见下面")
    for base in ['menu','layouts','pages','components','api','config','hooks']:
        p = os.path.join(LOCAL, base)
        if os.path.isdir(p):
            n = sum(1 for r,_,fs in os.walk(p) for f in fs if f.endswith(('.tsx','.ts')))
            print(f"   {base}: {n} files")
except Exception as e:
    print(f"[ERR] {type(e).__name__}: {e}")