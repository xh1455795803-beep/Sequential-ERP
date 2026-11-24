import urllib.request, json, sys

BASE = "https://thalvior.icu/rest/v1"
ANON = "eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw"

def req(method, path, body=None, prefer="return=representation"):
    url = f"{BASE}{path}"
    data = json.dumps(body).encode() if body else None
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header("apikey", ANON)
    r.add_header("Authorization", f"Bearer {ANON}")
    r.add_header("Content-Type", "application/json")
    r.add_header("Prefer", prefer)
    try:
        with urllib.request.urlopen(r, timeout=15) as resp:
            raw = resp.read().decode()
            if not raw: return None
            return json.loads(raw)
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        print(f"  HTTP {e.code}: {err[:300]}", file=sys.stderr)
        return None

# Pull ALL inventory fully
print("=== FULL inventory ===")
inv = req("GET", "/tlv_merchant_inventory?select=id,warehouse_id,merchant_id,product_id,sku,product_name,location,qty_on_hand,qty_reserved,inbound_qty,last_updated,first_in_at&order=merchant_id,sku")
print(json.dumps(inv, indent=2))

print("\n=== stock_takes full ===")
takes = req("GET", "/tlv_stock_takes?select=*&order=started_at.desc")
print(json.dumps(takes, indent=2))

print("\n=== stock_take_items full ===")
items = req("GET", "/tlv_stock_take_items?select=*&order=stock_take_id,row_no")
print(json.dumps(items, indent=2))
