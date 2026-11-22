#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# 用法（服务器上）：
#   LOGO_DIR=/tmp/qw/logos/final LOGO_NAMES=/opt/thalvior-source/ops/platform-logo-names.json \
#   python3 ops/scripts/fetch-platform-logos.py
# 抓完再跑 ops/scripts/gen-platform-logo-map.py 生成前端映射 + logo_url 回填 SQL。
# 说明：全部产物落到本地目录后再入库/发布，前端不引任何第三方图床外链。
"""v7 统一取图：为每个平台挑「最好的官方图标」。
优先级：站内声明的高清图标 > Google s2 (sz=256) > unavatar > iTunes 官方 App 图标 512px > Simple Icons 品牌色矢量 > DDG。
门槛：只接受 ≥48px 或矢量；已有更清晰的不降级。产物 /tmp/qw/logos/final/<slug>.<ext> + report7.json"""
import json, os, pathlib, re, struct, subprocess, time, urllib.parse
from concurrent.futures import ThreadPoolExecutor

FINAL = os.environ.get("LOGO_DIR", "/tmp/qw/logos/final")
WORK = os.environ.get("LOGO_WORK", "/tmp/qw/logos/w7")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"
os.makedirs(FINAL, exist_ok=True)
os.makedirs(WORK, exist_ok=True)

NAMES = json.load(open(os.environ.get("LOGO_NAMES", str(pathlib.Path(__file__).resolve().parent.parent / "ops" / "platform-logo-names.json"))))
# slug -> (域名候选, simple-icons 候选文件名, itunes 检索词, storefront)
META = {
    "alibaba-com": (["alibaba.com", "www.alibaba.com"], ["alibaba.com", "alibabacom"], "Alibaba.com", "us"),
    "aliexpress": (["aliexpress.com"], ["aliexpress"], "AliExpress", "us"),
    "allegro": (["allegro.pl"], ["allegro"], "Allegro", "pl"),
    "allvalue": (["allvalue.com"], [], "AllValue", "us"),
    "amazon": (["amazon.com"], ["amazon"], "Amazon", "us"),
    "b2w-americanas": (["americanas.com.br"], [], "Americanas", "br"),
    "bigcommerce": (["bigcommerce.com"], ["bigcommerce"], "BigCommerce", "us"),
    "cdiscount": (["cdiscount.com"], [], "Cdiscount", "fr"),
    "coupang": (["coupang.com"], [], "Coupang", "kr"),
    "daraz": (["daraz.pk", "www.daraz.com.bd"], [], "Daraz", "pk"),
    "ebay": (["ebay.com"], ["ebay"], "eBay", "us"),
    "emag": (["emag.ro"], [], "eMAG", "ro"),
    "etsy": (["etsy.com"], ["etsy"], "Etsy", "us"),
    "fnac": (["fnac.com"], ["fnac"], "Fnac", "fr"),
    "fruugo": (["fruugo.com"], [], "Fruugo", "gb"),
    "funpinpin": (["funpinpin.com"], [], "FunPinPin", "fr"),
    "gearbest": (["gearbest.com"], [], "Gearbest", "us"),
    "joom": (["joom.com"], [], "Joom", "us"),
    "jumia": (["jumia.com", "group.jumia.com"], [], "Jumia", "ma"),
    "kaufland": (["kaufland.de"], ["kaufland"], "Kaufland", "de"),
    "kilimall": (["kilimall.co.ke"], [], "Kilimall", "ke"),
    "lazada": (["lazada.com", "www.lazada.sg", "www.lazada.co.id"], [], "Lazada", "my"),
    "magento": (["magento.com"], ["magento"], "Magento", "us"),
    "mercadolibre": (["mercadolibre.com", "www.mercadolibre.com.ar"], [], "Mercado Libre", "ar"),
    "miravia": (["miravia.com", "www.miravia.es"], [], "Miravia", "es"),
    "noon": (["noon.com"], [], "noon", "ae"),
    "onbuy": (["onbuy.com"], [], "OnBuy", "gb"),
    "otto": (["otto.de"], ["otto"], "OTTO", "de"),
    "ozon": (["ozon.ru", "seller.ozon.ru", "ozon.global"], [], "Ozon", "ru"),
    "prestashop": (["prestashop.com"], ["prestashop"], "PrestaShop", "us"),
    "qoo10": (["qoo10.sg", "qoo10.com"], [], "Qoo10", "sg"),
    "rakuten": (["rakuten.com", "www.rakuten.co.jp"], ["rakuten"], "楽天市場", "jp"),
    "salla": (["salla.sa"], ["salla"], "Salla", "sa"),
    "shein": (["shein.com"], [], "SHEIN", "us"),
    "shopbase": (["shopbase.io"], [], "ShopBase", "us"),
    "shopee": (["shopee.com", "shopee.com.my", "shopee.sg"], ["shopee"], "Shopee", "sg"),
    "shopify": (["shopify.com"], ["shopify"], "Shopify", "us"),
    "shopline": (["shopline.com", "www.shoplineapp.com"], [], "SHOP LINE", "hk"),
    "shopyy": (["shopyy.com"], [], "Shopyy", "us"),
    "temu": (["temu.com"], [], "Temu", "us"),
    "tiki": (["tiki.vn"], [], "Tiki", "vn"),
    "tiktok": (["tiktok.com", "shop.tiktok.com"], ["tiktok"], "TikTok", "us"),
    "ueeshop": (["ueeshop.com"], [], "UEESHOP", "us"),
    "voghion": (["voghion.com"], [], "Voghion", "de"),
    "walmart": (["walmart.com"], ["walmart"], "Walmart", "us"),
    "wayfair": (["wayfair.com"], [], "Wayfair", "us"),
    "wildberries": (["wildberries.ru"], [], "Wildberries", "ru"),
    "wish": (["wish.com"], ["wish"], "Wish", "us"),
    "wix": (["wix.com"], ["wix"], "Wix", "us"),
    "woocommerce": (["woocommerce.com"], ["woocommerce"], "WooCommerce", "us"),
    "yandex-market": (["market.yandex.ru", "ya.ru"], [], "Яндекс Маркет", "ru"),
    "zalando": (["zalando.de"], ["zalando"], "ZALANDO", "de"),
    "jd-id": (["jd.co.id"], [], "JD.id", "id"),
    "jd-com": (["jd.com"], [], "京东", "cn"),
    "shoplazza": (["shoplazza.com"], [], "Shoplazza", "us"),
    "dhgate": (["dhgate.com"], [], "DHgate", "us"),
    "1688": (["1688.com"], [], "1688", "cn"),
    "taobao": (["taobao.com"], ["taobao"], "淘宝", "cn"),
}

try:
    SI_HEX = {re.sub(r"[^a-z0-9.]", "", i["title"].lower()): (i.get("hex") or "334155") for i in json.load(open(os.environ.get("SI_DATA", "/tmp/si11.json")))["icons"]}
except Exception:
    SI_HEX = {}


def curl(url, dest, timeout=10):
    try:
        r = subprocess.run(["curl", "-sL", "-m", str(timeout), "-A", UA, "-o", dest, "-w", "%{http_code} %{size_download}", url],
                           capture_output=True, text=True, timeout=timeout + 4)
    except subprocess.TimeoutExpired:
        return False, "timeout"
    out = (r.stdout or "").strip()
    return (r.returncode == 0 and out.startswith("200") and os.path.exists(dest) and os.path.getsize(dest) > 200), out


def classify(path):
    try:
        b = open(path, "rb").read()
    except Exception:
        return None
    if b[:5] == b"<?xml" or (len(b) > 260 and b"<svg" in b[:600].lower()):
        return ("svg", 9999) if b"</svg>" in b and len(b) > 260 else None
    if b[:8] == b"\x89png\r\n\x1a\n":
        try:
            w, h = struct.unpack(">II", b[16:24])
        except Exception:
            return None
        return ("png", max(w, h)) if w and h else None
    if b[:4] == b"\x00\x00\x01\x00":
        n = struct.unpack("<H", b[4:6])[0]
        best = 0
        for i in range(n):
            e = b[6 + 16 * i:22 + 16 * i]
            if len(e) < 16:
                break
            best = max(best, e[0] or 256, e[1] or 256)
        return ("ico", best) if best else None
    if b[:4] == b"RIFF" and b[8:12] == b"WEBP":
        return ("webp", 256)
    if b[:2] == b"\xff\xd8":
        return ("jpg", 512)
    return None


def rank(kind, dim):
    """站内/unavatar 的矢量最优先，其次高清位图；iTunes 512 略低于站内高清图（可能带节日角标）"""
    if kind == "svg":
        return 9000
    if kind == "ico":
        return dim * 3
    return dim


def cur(slug):
    for k in ("svg", "png", "ico", "webp", "jpg"):
        p = os.path.join(FINAL, f"{slug}.{k}")
        if os.path.exists(p):
            c = classify(p)
            if c:
                return (p, c[0], c[1], rank(*c))
            os.remove(p)
    return None


def put(path, kind, dim, slug, src):
    old = cur(slug)
    new = rank(kind, dim)
    if old and old[3] >= new:
        return None
    out = os.path.join(FINAL, f"{slug}.{kind}")
    if old and os.path.abspath(old[0]) != os.path.abspath(out):
        os.remove(old[0])
    os.replace(path, out)
    return {"file": f"{slug}.{kind}", "kind": kind, "dim": dim, "bytes": os.path.getsize(out), "src": src}


def site_icons(domains, slug):
    """站内 head 声明 + 常见路径，返回最优一个"""
    best = None
    for d in domains[:2]:
        wd = os.path.join(WORK, slug, d)
        os.makedirs(wd, exist_ok=True)
        page = os.path.join(wd, "p.html")
        hrefs = []
        if curl(f"https://{d}/", page, 9):
            try:
                txt = open(page, encoding="utf-8", errors="ignore").read()[:300000]
            except Exception:
                txt = ""
            for m in re.finditer(r"<link[^>]+rel=[\"']?(?:apple-touch-icon(?:-precomposed)?|icon)[^>]*>", txt, re.I):
                hm = re.search(r"href=[\"']([^\"']+)[\"']", m.group(0), re.I)
                sm = re.search(r"sizes=[\"'](\d+)x(\d+)[\"']", m.group(0), re.I)
                if hm:
                    hrefs.append((int(sm.group(1)) if sm else 0, hm.group(1)))
            hrefs.sort(key=lambda x: -x[0])
        urls = [urllib.parse.urljoin(f"https://{d}/", h) for _, h in hrefs[:3]]
        urls += [f"https://{d}/apple-touch-icon.png", f"https://{d}/apple-touch-icon-precomposed.png",
                 f"https://{d}/favicon-192x192.png", f"https://{d}/favicon.ico"]
        for i, u in enumerate(urls):
            dest = os.path.join(wd, f"i{i}")
            ok, _ = curl(u, dest, 8)
            if not ok:
                continue
            c = classify(dest)
            if not c:
                continue
            kind, dim = c
            if kind != "svg" and dim < 96:
                continue
            sp = os.path.join(wd, f"i{i}.{kind}")
            os.replace(dest, sp)
            if not best or rank(kind, dim) > best[0]:
                best = (rank(kind, dim), sp, kind, dim, f"site:{u[:60]}")
        if best and best[1] >= 9000:
            break
    return best


def google(domains, slug):
    wd = os.path.join(WORK, slug, "g")
    os.makedirs(wd, exist_ok=True)
    for d in domains[:2]:
        dest = os.path.join(wd, d)
        ok, _ = curl(f"https://www.google.com/s2/favicons?domain={d}&sz=256", dest, 9)
        if not ok:
            continue
        c = classify(dest)
        if not c:
            continue
        kind, dim = c
        if kind != "svg" and dim < 96:
            continue
        sp = os.path.join(wd, f"{d}.{kind}")
        os.replace(dest, sp)
        return (rank(kind, dim) - 200, sp, kind, dim, f"google:{d}")
    return None


def unav(domain, slug):
    wd = os.path.join(WORK, slug, "u")
    os.makedirs(wd, exist_ok=True)
    for prov in ("", "google/", "brave/"):
        dest = os.path.join(wd, prov or "def")
        ok, info = curl(f"https://unavatar.io/{prov}{domain}", dest, 10)
        time.sleep(1.2)
        if not ok:
            if "429" in info:
                time.sleep(4)
                ok, info = curl(f"https://unavatar.io/{prov}{domain}", dest, 10)
            if not ok:
                continue
        c = classify(dest)
        if not c:
            continue
        kind, dim = c
        if kind != "svg" and dim < 64:
            continue
        sp = os.path.join(wd, (prov or "def") + "." + kind)
        os.replace(dest, sp)
        return (rank(kind, dim) - 500, sp, kind, dim, f"unavatar:{prov or 'def'}")
    return None


def itunes(term, country, slug):
    wd = os.path.join(WORK, slug, "it")
    os.makedirs(wd, exist_ok=True)
    j = os.path.join(wd, "s.json")
    ok, _ = curl("https://itunes.apple.com/search?" + urllib.parse.urlencode(
        {"term": term, "country": country, "entity": "software", "limit": 4}), j, 12)
    if not ok:
        return None
    try:
        res = json.load(open(j)).get("results", [])
    except Exception:
        return None
    for r in res:
        art = r.get("artworkUrl100") or ""
        if "mzstatic.com" not in art:
            continue
        dest = os.path.join(wd, str(r.get("trackId", len(wd))))
        ok2, _ = curl(art.replace("100x100bb.jpg", "512x512bb.png"), dest, 12)
        if not ok2:
            continue
        c = classify(dest)
        if not c or c[1] < 256:
            continue
        kind, dim = c
        sp = os.path.join(wd, f"{r.get('trackId')}.{kind}")
        os.replace(dest, sp)
        # iTunes 图标可能与大促角标绑定，排在站内高清之后
        return (min(dim, 512) - 1, sp, kind, dim, f"itunes:{r.get('bundleId')}")
    return None


def si(slugs, slug):
    wd = os.path.join(WORK, slug, "si")
    os.makedirs(wd, exist_ok=True)
    for s in slugs:
        for probe in (s.replace(".", ""), s):
            dest = os.path.join(wd, probe)
            ok, _ = curl(f"https://cdn.jsdelivr.net/npm/simple-icons@11/icons/{probe}.svg", dest, 8)
            if not ok:
                continue
            txt = open(dest, encoding="utf-8", errors="ignore").read()
            if "<path" not in txt:
                continue
            hexv = SI_HEX.get(probe) or SI_HEX.get(probe.replace(".", "")) or "334155"
            txt = re.sub(r'fill="currentColor"', f'fill="#{hexv}"', txt)
            if "fill=" not in txt:
                txt = txt.replace("<svg", f'<svg fill="#{hexv}"', 1)
            if "viewBox" not in txt:
                txt = txt.replace("<svg", '<svg viewBox="0 0 24 24"', 1)
            out = os.path.join(wd, f"{probe}.svg")
            open(out, "w", encoding="utf-8").write(txt)
            if out != dest and os.path.exists(dest):
                os.remove(dest)
            return (4000, out, "svg", 9999, f"si11:{probe}#{hexv}")
    return None


def ddg(domain, slug):
    wd = os.path.join(WORK, slug, "ddg")
    os.makedirs(wd, exist_ok=True)
    dest = os.path.join(wd, "x")
    ok, _ = curl(f"https://icons.duckduckgo.com/ip3/{domain}.ico", dest, 8)
    if not ok:
        return None
    c = classify(dest)
    if not c or (c[0] != "svg" and c[1] < 48):
        return None
    sp = os.path.join(wd, f"x.{c[0]}")
    os.replace(dest, sp)
    return (rank(*c) - 1000, sp, c[0], c[1], "ddg")


def job(slug):
    domains, si_slugs, term, country = META[slug]
    old = cur(slug)
    if old and old[3] >= 9000:
        return slug, {"skip": f"{old[1]} {old[2]}px"}
    steps = [
        lambda: site_icons(domains, slug),
        lambda: google(domains, slug),
        lambda: unav(domains[0], slug),
        lambda: itunes(term, country, slug) if term else None,
        lambda: si(si_slugs, slug) if si_slugs else None,
        lambda: ddg(domains[0], slug),
    ]
    pool = []
    for fn in steps:
        try:
            r = fn()
        except Exception:
            r = None
        if r:
            pool.append(r)
        best = max((p[0] for p in pool), default=0)
        # 拿到矢量或 ≥256px 就够了，不必再打后面几个源；否则一直试到有更优为止
        if best >= 9000 or (500 <= best < 9000 and best > (old[3] if old else 0)):
            break
    if not pool:
        return slug, None
    pool.sort(key=lambda x: -x[0])
    _, path, kind, dim, src = pool[0]
    meta = put(path, kind, dim, slug, src)
    return slug, meta or {"keep": f"{old[1]} {old[2]}px" if old else "?"}


def main():
    rep = {}
    slugs = list(NAMES.keys())
    with ThreadPoolExecutor(max_workers=3) as ex:
        for slug, meta in ex.map(job, slugs):
            rep[slug] = meta
            print(f"{slug:16} {json.dumps(meta, ensure_ascii=False) if meta else 'MISS'}", flush=True)
    json.dump(rep, open(os.path.join(os.path.dirname(FINAL), "report7.json"), "w"), ensure_ascii=False, indent=1)
    files = sorted(os.listdir(FINAL))
    print(f"\nfiles={len(files)}/{len(slugs)}")
    print("MISS:", [s for s, m in rep.items() if not m])


if __name__ == "__main__":
    main()
