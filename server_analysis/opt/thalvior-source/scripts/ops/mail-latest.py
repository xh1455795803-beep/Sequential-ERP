"""读取收件箱最新一封邮件，输出结构化主题与正文（供模板回归断言使用）。"""
import os
# 敏感凭证一律从环境变量注入，禁止硬编码
MAIL_PASSWORD = os.environ.get("MAIL_PASSWORD", "")
SSH_PASSWORD = os.environ.get("SSH_PASSWORD", "")
import imaplib, email, sys, time
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
    return "\n".join(parts)


def strip_tags(html_text):
    import re
    text = re.sub(r"<br\s*/?>", "\n", html_text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    text = text.replace("&nbsp;", " ").replace("&amp;", "&")
    return text


def main():
    waited = float(sys.argv[1]) if len(sys.argv) > 1 else 3.0
    time.sleep(waited)
    mail = imaplib.IMAP4_SSL("imap.qq.com", 993)
    mail.login(USER, PWD)
    mail.select("INBOX")
    typ, data = mail.search(None, "ALL")
    ids = data[0].split()
    if not ids:
        print("LAST_SUBJECT=")
        print("LAST_BODY=")
        mail.logout()
        return
    # 按内部日期排序取最新
    latest = ids[-1]
    try:
        pairs = []
        for i in ids[-8:]:
            typ, dd = mail.fetch(i, "(INTERNALDATE)")
            try:
                pairs.append((imaplib.Internaldate2tuple(dd[0]), i))
            except Exception:
                pairs.append((None, i))
        pairs = [p for p in pairs if p[0] is not None]
        if pairs:
            pairs.sort()
            latest = pairs[-1][1]
    except Exception:
        pass

    typ, msgdata = mail.fetch(latest, "(RFC822)")
    msg = email.message_from_bytes(msgdata[0][1])
    subject = dec(msg.get("Subject", ""))
    raw_body = body_text(msg)
    body = strip_tags(raw_body)
    # 压缩空白，便于单值输出与断言
    compact = "\n".join(line.strip() for line in body.splitlines() if line.strip())
    print("LAST_SUBJECT=" + subject.replace("\n", " ").strip())
    print("LAST_BODY=" + compact.replace("\n", "\\n"))
    mail.logout()


if __name__ == "__main__":
    main()
