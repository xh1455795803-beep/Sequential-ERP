import sys
with open('/workspace/functions/sync-tiktok-orders/index.ts') as f: tpl = f.read()
for path, p, c in [
    ('/workspace/functions/sync-shopee-orders/index.ts', 'Shopee', 'shopee'),
    ('/workspace/functions/sync-lazada-orders/index.ts', 'Lazada', 'lazada'),
    ('/workspace/functions/sync-ozon-orders/index.ts', 'Ozon', 'ozon'),
    ('/workspace/functions/sync-mercado-orders/index.ts', 'Mercado Libre', 'mercado'),
]:
    out = tpl.replace('TikTok Shop', p).replace('tiktok', c)
    with open(path, 'w') as f: f.write(out)
print("✅ 4 sync-* functions generated")
