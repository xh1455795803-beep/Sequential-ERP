import requests, concurrent.futures

URLS = [
    'https://thalvior.icu/',
    'https://thalvior.icu/merchant/login',
    'https://thalvior.icu/wms/login',
    'https://thalvior.icu/admin/login',
    'https://thalvior.icu/rest/v1/',
    'https://thalvior.icu/auth/v1/settings',
    'https://thalvior.icu/functions/v1/generate-label-pdf',
    'https://thalvior.icu/storage/v1/',
    'https://thalvior.icu/api/',
    'https://thalvior.icu/privacy',
    'https://thalvior.icu/terms',
    'https://thalvior.icu/dashboard/',
    'https://thalvior.icu/erp/',
]

def hit(u):
    try:
        r = requests.get(u, allow_redirects=False, timeout=10)
        loc = r.headers.get('Location', '')
        return (u, r.status_code, loc[:60])
    except Exception as e:
        return (u, 'ERR', str(e)[:40])

with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
    for u, s, loc in ex.map(hit, URLS):
        print(f'  {s:>4}  {u}  {("→ " + loc) if loc else ""}')
