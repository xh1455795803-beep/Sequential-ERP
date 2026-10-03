"""读取 thalvior@foxmail.com 收件箱最新邮件，用于端到端验证验证码邮件是否真的送达。"""
import os
# 敏感凭证一律从环境变量注入，禁止硬编码
MAIL_PASSWORD = os.environ.get("MAIL_PASSWORD", "")
SSH_PASSWORD = os.environ.get("SSH_PASSWORD", "")
import imaplib, email, re, sys
from email.header import decode_header

USER = "thalvior@foxmail.com"
PWD = MAIL_PASSWORD

def dec(s):
    if not s:
        return ""
    parts = decode_header(s)
    out = ""
    for v, enc in parts:
        if isinstance(v, bytes):
            out += v.decode(enc or "utf-8", errors="ignore")
        else:
            out += str(v)
    return out

def main():
    m = imaplib.IMAP4_SSL("imap.qq.com", 993, timeout=30)
    m.login(USER, PWD)
    m.select("INBOX")
    typ, data = m.search(None, "ALL")
    ids = data[0].split()
    print(f"收件箱共 {len(ids)} 封，显示最新 3 封：")
    found_code = None
    for i in ids[-3:]:
        typ, msg_data = m.fetch(i, "(RFC822)")
        msg = email.message_from_bytes(msg_data[0][1])
        subj = dec(msg.get("Subject"))
        frm = dec(msg.get("From"))
        to = dec(msg.get("To"))
        print(f"\n--- 主题: {subj} | 发件: {frm} | 收件: {to}")
        body = ""
        if msg.is_multipart():
            for part in msg.walk():
                ct = part.get_content_type()
                if ct in ("text/plain", "text/html"):
                    payload = part.get_payload(decode=True)
                    charset = part.get_content_charset() or "utf-8"
                    body += payload.decode(charset, errors="ignore")
        else:
            payload = msg.get_payload(decode=True)
            charset = msg.get_content_charset() or "utf-8"
            body = payload.decode(charset, errors="ignore") if payload else ""
        # 去标签
        text = re.sub(r"<[^>]+>", " ", body)
        text = re.sub(r"\s+", " ", text).strip()
        print("正文节选:", text[:260])
        code = re.search(r"(?<!\d)(\d{6})(?!\d)", text)
        if code:
            found_code = code.group(1)
            print(">>> 提取到验证码:", found_code)
    m.logout()
    if found_code:
        print("\nRESULT_CODE=" + found_code)
    else:
        print("\nRESULT_CODE=NONE")

main()
