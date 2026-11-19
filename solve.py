#!/usr/bin/env python3
"""核心问题：auth 和 postgrest 到底怎么处理 JWT_SECRET? 算出 raw bytes!"""
import base64, hmac, hashlib, json

def b64url_decode(s):
    s = s + '=' * (-len(s) % 4)
    return base64.urlsafe_b64decode(s)

MEOO_ANON = "eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw"
header_meoo, payload_meoo, sig_meoo = MEOO_ANON.split('.')
sig_input = f"{header_meoo}.{payload_meoo}"

BAK_SECRET_B64 = "BRnoce2N0ZWRx+NZBWYEWnTlHVBI5jiE9DTyH/jie9A="  # base64 编码的
RAW_BYTES = base64.b64decode(BAK_SECRET_B64)
print(f"1. base64 decode 后的 raw bytes ({len(RAW_BYTES)} bytes):")
print(f"   hex: {RAW_BYTES.hex()}")
print(f"   repr: {repr(RAW_BYTES)}")
print(f"   ascii: {RAW_BYTES}")

# 用 raw bytes 验签
sig_raw = hmac.new(RAW_BYTES, sig_input.encode(), hashlib.sha256).digest()
sig_raw_b64url = base64.urlsafe_b64encode(sig_raw).rstrip(b'=').decode()
print(f"\n2. 用 raw bytes 验签: {sig_raw_b64url[-30:]} vs meoo {sig_meoo[-30:]} → {'✅ MATCH' if sig_raw_b64url == sig_meoo else '❌'}")

# 假设 .env 里存 base64 字符串，auth 把它当 raw bytes（不做 base64 decode）
# 也就是 secret = b"BRnoce2N0ZWRx+NZBWYEWnTlHVBI5jiE9DTyH/jie9A="
BAK_SECRET_AS_RAW = BAK_SECRET_B64.encode()  # 直接当字符串 bytes
sig_asraw = hmac.new(BAK_SECRET_AS_RAW, sig_input.encode(), hashlib.sha256).digest()
sig_asraw_b64url = base64.urlsafe_b64encode(sig_asraw).rstrip(b'=').decode()
print(f"3. 把 base64 字符串直接当 raw: {sig_asraw_b64url[-30:]} vs meoo {sig_meoo[-30:]} → {'✅ MATCH' if sig_asraw_b64url == sig_meoo else '❌'}")

# 结论：meoo 的 anon key 是用 RAW BYTES（base64 decode 后的）签的
# auth 容器如果把 .env 的 JWT_SECRET 直接当 raw bytes 用 → 需要 .env 里存 raw bytes
# postgrest 如果 IS_BASE64=true → 会对 .env 里的值做 base64 decode → 也能得到 raw bytes ✅
# postgrest 如果 IS_BASE64=false → 把 .env 里的值当 raw bytes → 如果 .env 里是 base64 字符串，那就是错的 ❌

# 所以：.env 里存 base64 字符串 + postgrest IS_BASE64=true → 两边都能正确 decode 到 raw bytes ✅
# 除非 auth 容器也需要 base64 decode...

# 让我看看 gotrue auth 的源码逻辑：GOTRUE_JWT_SECRET 是怎么处理的？
# Supabase auth (gotrue) 用的是 jose library，默认 secret 是 raw bytes 或 base64url
# 需要设置 GOTRUE_JWT_SECRET_IS_BASE64=true 吗？

# 另一个方案：把 RAW BYTES 直接存进 .env（base64 encode 的 .env 值 → 这样 postgrest IS_BASE64=false 就直接用）
# 但 raw bytes 里有非 printable 字符，.env 文件不能存 binary

# 最终方案：.env 里存 **base64 编码的 secret 字符串**，然后让 postgrest IS_BASE64=true，auth 默认也能处理？
# 不对，auth 默认是 raw bytes

# 让我换个思路：让 .env 里的值是 RAW BYTES 的 base64url 编码，然后 postgrest 和 auth 都能正确 decode
# 实际上 gotrue 支持 GOTRUE_JWT_SECRET 用 base64url！
# 让我验证：gotrue auth v2 源码...

# 算了，直接测：当前 auth 容器里 GOTRUE_JWT_SECRET 的值是 base64 字符串
# 如果 auth 不做 base64 decode，那它把 base64 字符串当 raw bytes 验签 → 会是 case 3 → ❌
# 但之前 auth 容器能正常签发 token（我们测试过 admin 登录成功）
# 说明 auth 确实做了 base64 decode！

# 等一下... 之前 auth 登录成功是在我改 JWT_SECRET 之前？
# 让我回忆：是的，在我改成 raw secret 之后，auth 也能成功签 token... 
# 因为 auth 容器和 postgrest 都能处理？

# 让我直接测当前配置下 auth sign-in
print("\n=== 直接测当前 auth ===")
import subprocess
result = subprocess.run(
    ["curl", "-sS", "-X", "POST", "http://43.133.232.81:8000/auth/v1/token?grant_type=password",
     "-H", f"apikey: {MEOO_ANON}",
     "-H", "Content-Type: application/json",
     "-d", json.dumps({"email":"admin@thalvior.icu","password":"3403641888"})],
    capture_output=True, text=True, timeout=15
)
print(f"Exit: {result.returncode}")
print(f"stdout: {result.stdout[:300]}")
print(f"stderr: {result.stderr[:200]}")
