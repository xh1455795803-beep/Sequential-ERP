#!/usr/bin/env python3
"""真实 HTTP 端到端测试 —— https://thalvior.icu"""
import sys
import time
import json
import base64
import re
import html.parser
from urllib.request import Request, urlopen
from urllib.parse import urlencode, urlparse
from urllib.error import HTTPError, URLError
from http.cookiejar import CookieJar

BASE = "https://thalvior.icu"
ANON_KEY = (
    "eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9."
    "eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ."
    "P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw"
)

ACCOUNTS = [
    ("merchant", "merchant@thalvior.dev", "Merchant1234!"),
    ("wms",      "wms@thalvior.dev",      "Wms1234!"),
    ("admin",    "admin@thalvior.dev",    "Admin1234!"),
]

API_TABLES = [
    "tlv_merchant_wallets",
    "tlv_outbound_orders",
    "tlv_inbound_orders",
    "tlv_merchant_inventory",
    "tlv_billings",
    "tlv_logistics_tracking",
]

# ---------- HTTP helpers ----------

def _proxy_env():
    import os
    return {k: v for k, v in os.environ.items()
            if k.lower() in ("http_proxy","https_proxy","all_proxy","no_proxy")}

def _req(url, method="GET", headers=None, body=None, timeout=25):
    hdrs = {
        "User-Agent": "thalvior-e2e/1.0 (+python urllib)",
        "Accept": "application/json, text/plain, */*",
    }
    if headers: hdrs.update(headers)
    data = None
    if body is not None:
        if isinstance(body, dict):
            data = urlencode(body).encode()
            hdrs.setdefault("Content-Type", "application/x-www-form-urlencoded")
        elif isinstance(body, (bytes, bytearray)):
            data = bytes(body)
        else:
            data = str(body).encode()
    req = Request(url, data=data, headers=hdrs, method=method)
    t0 = time.time()
    try:
        resp = urlopen(req, timeout=timeout)
        dt = (time.time() - t0) * 1000
        raw = resp.read()
        return resp.status, dict(resp.headers), raw, dt, None
    except HTTPError as e:
        dt = (time.time() - t0) * 1000
        raw = e.read() if hasattr(e, "read") else b""
        return e.code, dict(e.headers or {}), raw, dt, str(e)
    except URLError as e:
        dt = (time.time() - t0) * 1000
        return None, {}, b"", dt, f"URLError: {e.reason}"
    except Exception as e:
        dt = (time.time() - t0) * 1000
        return None, {}, b"", dt, f"{type(e).__name__}: {e}"

def _summary(raw, maxlen=200):
    if not raw: return "(empty)"
    try: s = raw.decode("utf-8", errors="replace")
    except: s = str(raw)
    s = s.replace("\n"," ").replace("\r"," ")
    return s[:maxlen]

# ---------- 1. 登录页 HTML ----------

PAGE_PATHS = ["/merchant", "/wms", "/admin"]

def step1_pages():
    print("\n" + "="*70)
    print("STEP 1 —— GET 登录页 HTML")
    print("="*70)
    ok = True
    for p in PAGE_PATHS:
        url = BASE + p
        status, hdrs, raw, dt, err = _req(url)
        tag = "[OK]" if (status and 200 <= status < 400 and err is None) else "[FAIL]"
        print(f"\n{tag} GET {url}  →  HTTP {status}  {dt:.0f}ms")
        if err:
            print(f"     ERROR: {err}")
            print(f"     RESP:  {_summary(raw)}")
            ok = False
            continue
        if not raw:
            print("     WARN: empty body")
            ok = False
            continue
        html = raw.decode("utf-8", errors="replace")
        m_title = re.search(r"<title>(.*?)</title>", html, re.I|re.S)
        title = m_title.group(1).strip() if m_title else "(no <title>)"
        scripts = re.findall(r'<script[^>]+src=["\']([^"\']+)["\']', html, re.I)
        print(f"     <title>:  {title}")
        print(f"     <script src> count: {len(scripts)}")
        for s in scripts[:5]:
            print(f"        - {s}")
        if len(scripts) > 5: print(f"        ... (+{len(scripts)-5} more)")
        # sanity
        if "<!doctype html>" not in html.lower() and "<html" not in html.lower():
            print("     WARN: 不像 HTML 文档")
            ok = False
    return ok

# ---------- 2. Signin ----------

def step2_signin():
    print("\n" + "="*70)
    print("STEP 2 —— POST /auth/v1/token (password)")
    print("="*70)
    tokens = {}
    for role, email, pwd in ACCOUNTS:
        url = BASE + "/auth/v1/token?grant_type=password"
        body = json.dumps({"email": email, "password": pwd}).encode()
        headers = {
            "apikey": ANON_KEY,
            "Authorization": f"Bearer {ANON_KEY}",
            "Content-Type": "application/json",
        }
        status, hdrs, raw, dt, err = _req(url, method="POST", headers=headers, body=body)
        tag = "[OK]" if (status == 200 and err is None) else "[FAIL]"
        print(f"\n{tag} POST signin role={role} email={email}  →  HTTP {status}  {dt:.0f}ms")
        if err:
            print(f"     ERROR: {err}")
            print(f"     RESP:  {_summary(raw)}")
            continue
        try:
            data = json.loads(raw)
        except Exception as e:
            print(f"     FAIL: JSON parse error {e}")
            print(f"     RAW:  {_summary(raw)}")
            continue
        access = data.get("access_token")
        refresh = data.get("refresh_token")
        user = data.get("user") or {}
        meta = data.get("user_metadata") or user.get("user_metadata") or {}
        print(f"     access_token len = {len(access) if access else 'MISSING'}")
        print(f"     refresh_token    = {'present' if refresh else 'MISSING'}")
        print(f"     user.id          = {user.get('id')}")
        print(f"     user.email       = {user.get('email')}")
        print(f"     user.role        = {user.get('role')}")
        print(f"     user_metadata    = {json.dumps(meta, ensure_ascii=False)}")
        if not access:
            print("     FAIL: no access_token!")
            continue
        tokens[role] = {
            "access": access,
            "refresh": refresh,
            "user": user,
            "metadata": meta,
        }
    return tokens

# ---------- Decode JWT payload ----------

def decode_jwt_payload(token):
    parts = token.split(".")
    if len(parts) < 2:
        return None
    pad = "=" * (-len(parts[1]) % 4)
    try:
        raw = base64.urlsafe_b64decode(parts[1] + pad)
        return json.loads(raw.decode("utf-8"))
    except Exception as e:
        return {"error": str(e)}

# ---------- 3+4. REST API ----------

def step3_rest(tokens):
    print("\n" + "="*70)
    print("STEP 3+4 —— REST API 调用（带 token）")
    print("="*70)
    report = {}
    for role, tinfo in tokens.items():
        print(f"\n------- role={role} -------")
        access = tinfo["access"]
        headers = {
            "apikey": ANON_KEY,
            "Authorization": f"Bearer {access}",
            "Prefer": "return=representation",
        }
        report[role] = {}
        for table in API_TABLES:
            url = BASE + "/rest/v1/" + table
            status, hdrs, raw, dt, err = _req(url, method="GET", headers=headers)
            ok = (status == 200 and err is None)
            # 401 / 403 也记一下
            tag = "[OK]" if ok else ("[401]" if status == 401 else ("[403]" if status == 403 else "[FAIL]"))
            print(f"  {tag} GET /rest/v1/{table}  →  HTTP {status}  {dt:.0f}ms")
            info = {"status": status, "ms": dt, "err": err}
            if err:
                print(f"       ERROR: {err}")
                print(f"       RESP:  {_summary(raw)}")
                report[role][table] = info
                continue
            # JSON 检查
            try:
                data = json.loads(raw)
                info["json"] = True
            except Exception as e:
                info["json"] = False
                info["json_err"] = str(e)
                print(f"       FAIL: 非法 JSON ({e})")
                print(f"       RAW:  {_summary(raw)}")
                report[role][table] = info
                continue
            # items 数组
            items = None
            if isinstance(data, dict):
                for k in ("items", "data", "result"):
                    if k in data and isinstance(data[k], list):
                        items = data[k]; break
                if items is None:
                    # 也可能直接返回数组
                    if isinstance(data, list): items = data
            elif isinstance(data, list):
                items = data
            if items is None:
                print(f"       WARN: 响应无 items 数组 (keys={list(data.keys()) if isinstance(data,dict) else type(data).__name__})")
            else:
                info["items"] = len(items)
                print(f"       items[] 长度 = {len(items)}  type={type(data).__name__}")
            print(f"       摘要: {_summary(raw)}")
            report[role][table] = info
    return report

# ---------- 5. Token metadata + tenant_id ----------

def step5_metadata(tokens):
    print("\n" + "="*70)
    print("STEP 5 —— JWT metadata & tenant_id 检查")
    print("="*70)
    for role, tinfo in tokens.items():
        payload = decode_jwt_payload(tinfo["access"])
        print(f"\nrole={role}")
        if not payload:
            print("  FAIL: 无法 decode JWT")
            continue
        # 找 tenant_id
        tenant_id = (
            payload.get("tenant_id")
            or payload.get("app_metadata", {}).get("tenant_id")
            or payload.get("user_metadata", {}).get("tenant_id")
            or payload.get("metadata", {}).get("tenant_id")
        )
        role_claim = (
            payload.get("role")
            or payload.get("app_metadata", {}).get("role")
            or payload.get("user_metadata", {}).get("role")
        )
        print(f"  JWT payload keys : {sorted(payload.keys())}")
        print(f"  sub              : {payload.get('sub')}")
        print(f"  role (claim)     : {payload.get('role')}  app_meta.role={payload.get('app_metadata',{}).get('role')}  user_meta.role={payload.get('user_metadata',{}).get('role')}")
        print(f"  tenant_id (claim): {tenant_id}")
        print(f"  aud              : {payload.get('aud')}")
        print(f"  iss              : {payload.get('iss')}")
        print(f"  exp              : {payload.get('exp')}  iat={payload.get('iat')}")
        # 完整 metadata
        user_meta = payload.get("user_metadata", {}) or {}
        app_meta  = payload.get("app_metadata", {}) or {}
        print(f"  user_metadata    : {json.dumps(user_meta, ensure_ascii=False)}")
        print(f"  app_metadata     : {json.dumps(app_meta, ensure_ascii=False)}")
        # 也看看 signin 返回里的 user_metadata
        if tinfo.get("metadata"):
            print(f"  signin user_meta : {json.dumps(tinfo['metadata'], ensure_ascii=False)}")

# ---------- Summary ----------

def summary(page_ok, tokens, report):
    print("\n" + "="*70)
    print("FINAL SUMMARY")
    print("="*70)
    total = 0; passed = 0; failed = 0
    for role, tables in report.items():
        for t, info in tables.items():
            total += 1
            s = info.get("status")
            ok = (s == 200 and info.get("json") is True)
            if ok: passed += 1
            else:  failed += 1
            mark = "✔" if ok else "✘"
            print(f"  {mark} {role:8s} /rest/v1/{t:28s}  HTTP {s}  items={info.get('items','?')}  err={info.get('err','')}")
    print(f"\n登录页: {'OK' if page_ok else '有异常'}")
    print(f"Token  数量: {len(tokens)}")
    print(f"REST  总数: {total}  通过: {passed}  失败: {failed}")
    return failed == 0 and page_ok

# ---------- main ----------

def main():
    print("="*70)
    print("Thalvior 真实 HTTP E2E 测试")
    print(f"target = {BASE}")
    print(f"proxy env = {_proxy_env()}")
    print("="*70)
    page_ok  = step1_pages()
    tokens   = step2_signin()
    if not tokens:
        print("\nFATAL: 一个 token 都没拿到，后续跳过")
        return 2
    report   = step3_rest(tokens)
    step5_metadata(tokens)
    all_ok = summary(page_ok, tokens, report)
    print("\n>>> OVERALL:", "PASS" if all_ok else "FAIL")
    return 0 if all_ok else 1

if __name__ == "__main__":
    sys.exit(main())
