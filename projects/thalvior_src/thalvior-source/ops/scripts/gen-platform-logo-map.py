#!/usr/bin/env python3
"""由 /tmp/qw/logos/final 的实际产物生成两处真值：
1) src/components/platform-logo.tsx 里的 PLATFORM_LOGOS 映射（平台名 → 站内路径）
2) ops/sql/set_platform_logos.sql（platform_configs.logo_url 回填，含 Amazon 各站点）
平台名以 names.json 为准（与 platform_configs.name / 前端 fallbackPlatforms 对齐）。"""
import json, os, re
from pathlib import Path

FINAL = Path(os.environ.get("LOGO_DIR", "/tmp/qw/logos/final"))
ROOT = Path(__file__).resolve().parent.parent.parent
NAMES = json.load(open(os.environ.get("LOGO_NAMES", str(ROOT / "ops" / "platform-logo-names.json"))))
TSX = ROOT / "src/components/platform-logo.tsx"
SQL = ROOT / "ops/sql/set_platform_logos.sql"

AMAZON_SITES = ["Amazon US", "Amazon JP", "Amazon EU", "Amazon CA", "Amazon AU"]

found = {}
for slug, disp in NAMES.items():
    for k in ("svg", "png", "ico", "webp", "jpg"):
        p = FINAL / f"{slug}.{k}"
        if p.exists() and p.stat().st_size > 200:
            found[disp] = f"/platform-logos/{p.name}"
            break

# 平台名 → 站内路径；同一张图可服务多个站点名（Amazon 五个站点见下）
lines = []
for disp in sorted(found, key=lambda x: x.lower()):
    lines.append(f'  "{disp}": "{found[disp]}",')
for site in AMAZON_SITES:
    if "Amazon" in found and site not in found:
        lines.append(f'  "{site}": "{found["Amazon"]}",')

src = TSX.read_text(encoding="utf-8")
block = "export const PLATFORM_LOGOS: Record<string, string> = {\n" + "\n".join(lines) + "\n};"
src = re.sub(r"export const PLATFORM_LOGOS: Record<string, string> = \{[^}]*\};", block, src, count=1, flags=re.S)
TSX.write_text(src, encoding="utf-8")

# SQL：按平台名回填 logo_url（幂等）
sql = ["-- 平台 logo 站内路径回填（由 ops/scripts/gen-platform-logo-map.py 生成，勿手改单个值）",
       "-- 覆盖 name → /platform-logos/<file>；缺图平台保持 NULL，前端自动降级为字母芯片。", ""]
for disp, path in sorted(found.items(), key=lambda kv: kv[0].lower()):
    e = disp.replace("'", "''")
    sql.append(f"update platform_configs set logo_url = '{path}' where name = '{e}';")
for site in AMAZON_SITES:
    if "Amazon" in found:
        sql.append(f"update platform_configs set logo_url = '{found['Amazon']}' where name = '{site}';")
sql.append("select count(*) filter (where nullif(trim(coalesce(logo_url,'')),'') is not null) as with_logo, count(*) as total from platform_configs;")
SQL.parent.mkdir(parents=True, exist_ok=True)
SQL.write_text("\n".join(sql) + "\n", encoding="utf-8")
print(f"map entries={len(lines)} -> {TSX}, {SQL}")
print("missing (无 logo):", [d for d in NAMES.values() if d not in found])
