#!/usr/bin/env python3
"""算清楚 auth 和 postgrest 的 secret bytes 到底差在哪."""
import base64, hmac, hashlib, json, urllib.request

def b64url_d(s):
    s = s + '=' * (-len(s) % 4)
    return base64.urlsafe_b64decode(s)

CORRECT_SECRET = "BRnoce2N0ZWRx+NZBWYEWnTlHVBI5jiE9DTyH/jie9A="

# auth 签的 token（刚 sign-in 拿到的）
AUTH_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHRwczovL3RoYWx2aW9yLmljdSIsInN1YiI6IjZmOWZjMjY1LTdlZDgtNDhhMy1hMWIxLWNkYzE4ZjMxMGJhZSIsImF1ZCI6ImF1dGhlbnRpY2F0ZWQiLCJleHAiOjE3OTUwOTY5ODUsImlhdCI6MTc5NTA3NTM4NSwiZW1haWwiOiJhZG1pbkB0aGFsdvior.icu"

# 直接从外部 sign-in 拿个最新 token
MEOO_ANON = "eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw"

try:
    req = urllib.request.Request(
        "http://localhost:8000/auth/v1/token?grant_type=password",
        headers={
            "apikey": MEOO_ANON,
            "Content-Type": "application/json"
        },
        data=json.dumps({"email":"admin@thalvior.icu","password":"3403641888"}).encode(),
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        d = json.loads(resp.read())
        token = d["access_token"]
        print(f"Fresh token: {token[:50]}...")
except Exception as ex:
    print(f"Auth sign-in fail: {ex}")
    token = AUTH_TOKEN

header, payload, sig = token.split('.')
sig_input = f"{header}.{payload}"

print(f"\nHeader:  {b64url_d(header).decode()}")
print(f"Payload: {b64url_d(payload).decode()}")
print(f"Auth sig: ...{sig[-20:]}")

# 尝试不同 secret bytes 验签
print("\n=== 尝试验签 auth token ===")
tests = [
    ("raw string (auth 可能直接用)", CORRECT_SECRET.encode()),
    ("base64 decode (postgrest IS_BASE64=true)", base64.b64decode(CORRECT_SECRET)),
]
for name, sec in tests:
    sig_computed = hmac.new(sec, sig_input.encode(), hashlib.sha256).digest()
    sig_b64 = base64.urlsafe_b64encode(sig_computed).rstrip(b'=').decode()
    match = "✅ MATCH" if sig_b64 == sig else "❌"
    print(f"  {name}: {match}")
    print(f"    computed sig: ...{sig_b64[-20:]}")

# meoo anon key 也是 auth 签的（但很早以前）
print("\n=== 尝试用当前 auth secret 验 meoo anon key ===")
header_m, payload_m, sig_m = MEOO_ANON.split('.')
sig_input_m = f"{header_m}.{payload_m}"
for name, sec in tests:
    sig_computed = hmac.new(sec, sig_input_m.encode(), hashlib.sha256).digest()
    sig_b64 = base64.urlsafe_b64encode(sig_computed).rstrip(b'=').decode()
    match = "✅ MATCH meoo" if sig_b64 == sig_m else "❌"
    print(f"  {name}: {match} (computed=...{sig_b64[-20:]}, meoo=...{sig_m[-20:]})")

# 结论：如果 auth 和 postgrest 用的是同一个 secret bytes，验签就通过
# meoo anon key 是 "raw string" 方式签的 → 说明 auth 用 raw string
# 所以 postgrest IS_BASE64=false 才能一致！
print("\n=== 结论 ===")
print("如果 auth 用 raw string，postgrest 也必须 IS_BASE64=false")
print("让我改成 IS_BASE64=false 试试")
