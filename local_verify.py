#!/usr/bin/env python3
"""本地算签名 — 哪个 secret 能签出 meoo 的 anon key?"""
import base64, hmac, hashlib, json

def b64url_decode(s):
    s = s + '=' * (-len(s) % 4)
    return base64.urlsafe_b64decode(s)

def b64url_encode(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()

MEOO_ANON = "eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw"
BAK_ANON = "eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.KCQJwqKfYexEfOp1cv6VvuF0y37ydP5szTPd9EqF-WI"

header_meoo, payload_meoo, sig_meoo = MEOO_ANON.split('.')
header_bak, payload_bak, sig_bak = BAK_ANON.split('.')

print(f"meoo anon payload: {b64url_decode(payload_meoo).decode()}")
print(f"bak anon payload:  {b64url_decode(payload_bak).decode()}")
print(f"payloads same: {payload_meoo == payload_bak}")

# 备份里的 secret
secrets_to_test = [
    ("bak (no pad)", "BRnoce2N0ZWRx+NZBWYEWnTlHVBI5jiE9DTyH/ji"),
    ("bak (with pad)", "BRnoce2N0ZWRx+NZBWYEWnTlHVBI5jiE9DTyH/jie9A="),
    ("bak2 (no pad)", "BRnoce2N0ZWRx+NZBWYEWnTlHVBI5jiE9DTyH/ji"),
    ("bak2 (with pad)", "BRnoce2N0ZWRx+NZBWYEWnTlHVBI5jiE9DTyH/jie9A="),
]

sig_input = f"{header_meoo}.{payload_meoo}"
print(f"\n签名输入: {sig_input[:40]}...")
print(f"meoo 签名: {sig_meoo}")
print(f"bak 签名:  {sig_bak}")

print("\n=== 验证 meoo 签名 ===")
for name, sec in secrets_to_test:
    try:
        sec_bytes = b64url_decode(sec)
        sig = hmac.new(sec_bytes, sig_input.encode(), hashlib.sha256).digest()
        sig_b64 = b64url_encode(sig)
        match = "✅ MATCH meoo" if sig_b64 == sig_meoo else ("✅ MATCH bak" if sig_b64 == sig_bak else "❌ no match")
        print(f"  {name}: {sig_b64[-30:]} {match}")
        print(f"    secret decoded ({len(sec_bytes)} bytes): {sec_bytes.hex()}")
    except Exception as ex:
        print(f"  {name}: error {ex}")

# 还有个可能：原始 secret 不是 base64，是 raw
print("\n=== 如果 secret 是 raw bytes ===")
raw_secrets = [
    ("thalvior-wms shared", "thalvior-wms-supabase-shared-jwt-secret-v1"),
    ("我改的 raw", "thalvior-wms-supabase-jwt-secret-v1-fixed-2026-wb-v2"),
    ("原始可能 raw", "thalvior-shared-supabase-jwt-secret-v1"),
]
for name, sec in raw_secrets:
    sig = hmac.new(sec.encode(), sig_input.encode(), hashlib.sha256).digest()
    sig_b64 = b64url_encode(sig)
    match = "✅ MATCH meoo" if sig_b64 == sig_meoo else ("✅ MATCH bak" if sig_b64 == sig_bak else "❌ no match")
    print(f"  {name}: {sig_b64[-30:]} {match}")

# 暴力：所有备份里的 anon key 都是 iat=1790268016 签的，签名却不同
# 说明不同时间 build 用了不同 secret
# meoo build 时间 ≈ iat 时间 (2026-09-24)
# 看看 9月的备份 anon key 是哪个签名

# 另一个思路：auth 容器启动时的 GOTRUE_JWT_SECRET
# 如果我能让 auth 支持两个 secret... 不行
# 但是！如果我让 meoo 也用新 secret 签的 anon key...
# meoo 硬编码了旧 key，无法改
# 除非用 nginx sub_filter 替换 meoo JS 里的 anon key！

print("\n=== 方案：nginx sub_filter 替换 meoo 里的硬编码 anon key ===")
print(f"meoo 硬编码: {MEOO_ANON}")
print(f"我需要用当前新 secret 签一个新 anon key 替换它")
