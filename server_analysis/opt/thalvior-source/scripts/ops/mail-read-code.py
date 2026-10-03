"""读取收件箱最新一封 Thalvior 验证码邮件，提取 6 位验证码（用于端到端验证）。"""
import os
# 敏感凭证一律从环境变量注入，禁止硬编码
MAIL_PASSWORD = os.environ.get("MAIL_PASSWORD", "")
SSH_PASSWORD = os.environ.get("SSH_PASSWORD", "")
import imaplib, email, re, sys
from email.header import decode_header

USER = "thalvior@foxmail.com"
PWD = MAIL_PASSWORD


def dec(s):
    try:
        out = ""
        for v, enc in decode_header(s or ""):
            if isinstance(v, bytes):
                try:
                    out += v.decode(enc or "utf-8", errors="ignore")
                except (LookupError, TypeError):
                    out += v.decode("utf-8", errors="ignore")
            else:
                out += str(v)
        return out
    except Exception:
        return str(s or "")


def body_text(msg):
    parts = []
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() in ("text/plain", "text/html"):
                payload = part.get_payload(decode=True)
                if not payload:
                    continue
                charset = part.get_content_charset() or "utf-8"
                try:
                    parts.append(payload.decode(charset, errors="ignore"))
                except (LookupError, TypeError):
                    parts.append(payload.decode("utf-8", errors="ignore"))
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            charset = msg.get_content_charset() or "utf-8"
            try:
                parts.append(payload.decode(charset, errors="ignore"))
            except (LookupError, TypeError):
                parts.append(payload.decode("utf-8", errors="ignore"))
    raw = " ".join(parts)
    raw = re.sub(r"<[^>]+>", " ", raw)
    return re.sub(r"\s+", " ", raw).strip()


m = imaplib.IMAP4_SSL("imap.qq.com", 993, timeout=30)
m.login(USER, PWD)
m.select("INBOX")
typ, data = m.search(None, "ALL")
ids = data[0].split()
code = None
for i in reversed(ids):
    t, d = m.fetch(i, "(RFC822)")
    msg = email.message_from_bytes(d[0][1])
    text = body_text(msg)
    subj = dec(msg.get("Subject"))
    print("主题:", subj)
    print("正文节选:", text[:160])
    match = re.search(r"(?<!\d)(\d{6})(?!\d)", text)
    if match and "Thalvior" in text:
        code = match.group(1)
        print(">>> 验证码:", code)
        break
m.logout()
print("RESULT_CODE=" + (code or "NONE"))
sys.exit(0 if code else 1)
