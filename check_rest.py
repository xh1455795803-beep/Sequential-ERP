import urllib.request, json

BASE = "https://thalvior.icu/rest/v1"
ANON = "eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw"

def q(path):
    url = f"{BASE}{path}"
    req = urllib.request.Request(url, headers={
        "apikey": ANON,
        "Authorization": f"Bearer {ANON}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    })
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        return f"ERROR: {e}"

# Test proxy
proxies = urllib.request.getproxies()
print("Proxies:", proxies)

tables = [
    "/tlv_stock_takes?order=started_at.desc",
    "/tlv_stock_take_items?order=stock_take_id",
    "/tlv_merchant_inventory?order=merchant_id",
    "/tlv_inventory_logs?order=created_at.desc&limit=20",
    "/tlv_merchant_wallets?order=created_at.desc",
]

for t in tables:
    print(f"\n=== {t.split('?')[0].replace('/','')} ===")
    data = q(t)
    if isinstance(data, list):
        print(json.dumps(data, indent=2, default=str)[:2000])
        if len(data) > 5:
            print(f"  ... ({len(data)} rows total)")
    else:
        print(data)
