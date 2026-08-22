#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""通过HTTP代理CONNECT隧道SSH执行远程命令。
用法: python3 ssh_cmd.py "远程命令"
多行脚本用: python3 ssh_cmd.py --script 脚本路径
"""
import sys, socket, paramiko, io

PROXY_HOST, PROXY_PORT = "127.0.0.1", 18080
TARGET_HOST, TARGET_PORT = "120.55.6.75", 22
SSH_USER, SSH_PASS = "admin", "yuan340364"

def make_proxy_sock():
    s = socket.create_connection((PROXY_HOST, PROXY_PORT), timeout=20)
    req = (f"CONNECT {TARGET_HOST}:{TARGET_PORT} HTTP/1.1\r\n"
           f"Host: {TARGET_HOST}:{TARGET_PORT}\r\n\r\n").encode()
    s.sendall(req)
    # 读取代理响应头
    buf = b""
    while b"\r\n\r\n" not in buf:
        chunk = s.recv(4096)
        if not chunk:
            break
        buf += chunk
    if b" 200 " not in buf.split(b"\r\n")[0]:
        raise RuntimeError("代理CONNECT失败: " + buf[:200].decode(errors="replace"))
    # 丢弃可能多读的后续字节(SSH banner),交给paramiko读
    return s

def run(cmd_text, use_sudo=False):
    sock = make_proxy_sock()
    tr = paramiko.Transport(sock)
    tr.set_keepalive(30)
    try:
        tr.connect(username=SSH_USER, password=SSH_PASS)
    except Exception as e:
        tr.close()
        raise RuntimeError(f"SSH认证失败: {e}")
    ch = tr.open_session()
    ch.settimeout(120)
    if use_sudo:
        ch.exec_command("sudo -S -p '' bash -lc " + _sh_quote(cmd_text))
    else:
        ch.exec_command("bash -lc " + _sh_quote(cmd_text))
    # sudo需要通过stdin传密码
    try:
        if use_sudo:
            ch.sendall((SSH_PASS + "\n").encode())
    except Exception:
        pass
    out = err = b""
    try:
        while True:
            if ch.recv_ready():
                d = ch.recv(65536)
                out += d
            elif ch.recv_stderr_ready():
                d = ch.recv_stderr(65536)
                err += d
            elif ch.exit_status_ready() and not ch.recv_ready() and not ch.recv_stderr_ready():
                break
    except socket.timeout:
        pass
    rc = ch.recv_exit_status()
    sys.stdout.write(out.decode("utf-8", errors="replace"))
    if err:
        sys.stderr.write("[STDERR]\n" + err.decode("utf-8", errors="replace"))
    sys.stdout.write(f"\n[EXIT_CODE={rc}]\n")
    tr.close()
    return rc

def _sh_quote(s):
    return "'" + s.replace("'", "'\\''") + "'"

if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("用法: ssh_cmd.py \"命令\"  |  --script 文件  |  --sudo \"命令\"")
    if sys.argv[1] == "--script":
        with open(sys.argv[2], "r", encoding="utf-8") as f:
            cmd = f.read()
        sys.exit(run(cmd))
    if sys.argv[1] == "--sudo":
        sys.exit(run(sys.argv[2], use_sudo=True))
    sys.exit(run(sys.argv[1]))
