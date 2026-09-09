#!/usr/bin/env python3
import re, io, sys

PAGES = [
    "Dashboard.tsx","OrderList.tsx","ProductList.tsx","ProductEdit.tsx",
    "InventoryList.tsx","ShopList.tsx","FinanceList.tsx","SystemSettings.tsx",
]
BASE = "/workspace/thalvior-src"
used = set()   # keys referenced
dynamic = []   # keys built from template/expression
for fn in PAGES:
    s = open(f"{BASE}/pages/{fn}", encoding="utf-8").read()
    # t('pages.x.y') literal
    used |= set(re.findall(r"t\('pages\.((?:[^']|\\.)+)'\)", s))
    used |= set(re.findall(r't\("pages\.((?:[^"]|\\")+)"\)', s))
    # template literals with interpolation -> record
    for m in re.findall(r"t\(`pages\.([^`]+)`\)", s):
        dynamic.append((fn, m))

# load zh dict
zsrc = open(f"{BASE}/i18n/pages/zh-CN.ts", encoding="utf-8").read()
# crude: build nested paths from the object by scanning key: 'value' at various indentation
# Instead parse structure via indentation-based tokenizer is complex; do a presence search:
def has_path(dictsrc, path):
    # search for the sub-path in the json-like dict
    segs = path.split('.')
    # find top-level key
    return None

# Simpler: convert ts object literal to json by replacing oneline mapping values is hard.
# Use ast-free approach: we reconstruct dict from source using a small parser.
import json
def parse_ts_obj(text, start):
    # find matching brace from text[start] which is '{'
    i = start
    depth = 0
    for j in range(start, len(text)):
        c = text[j]
        if c == '{': depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                return j
    raise RuntimeError("unbalanced")

def load_dict(src):
    # find "export const pagesZhCN = {...};"
    start = src.index("export const pagesZhCN = ") + len("export const pagesZhCN = ")
    end = parse_ts_obj(src, src.index("{", start))
    body = src[:end+1].replace("export const pagesZhCN = ", "")
    return body

body = load_dict(zsrc)

def key_exists(path):
    cur = body
    # rebuild: we validate by regex checking " path.seg:" presence hierarchy is fragile.
    # Instead recursively parse braces.
    idx = body.index("{")
    node_start = idx
    # parse recursively into dict key->value span
    def parse(start):
        # start at '{', returns dict of key -> (type,value_or_childspan)
        d = {}
        i = start
        while i < len(body):
            # skip until we hit a key or }
            pass
    return True

# Fallback: manual hierarchical existence check using regex within successive braces
def key_exists2(path):
    segs = path.split('.')
    seg = segs[0]
    # find top-level "  seg: {"
    m = re.search(r'\b' + re.escape(seg) + r'\s*:\s*\{', body)
    if not m:
        return False
    # locate matching brace
    start = body.index("{", m.start())
    end = parse_ts_obj(body, start)
    sub = body[start:end+1]
    for s in segs[1:]:
        mm = re.search(r'\b' + re.escape(s) + r'\s*:\s*\{', sub)
        if not mm:
            # maybe it's a simple value key "s: '...'"
            if re.search(r'\b' + re.escape(s) + r'\s*:\s*[`\'"]', sub):
                return True
            return False
        start = sub.index("{", mm.start())
        end = parse_ts_obj(sub, start)
        sub = sub[start:end+1]
    return True

missing = [k for k in used if not key_exists2(k)]
print("TOTAL literal keys used:", len(used))
print("MISSING (literal):", len(missing))
for k in sorted(missing):
    print("  MISSING", k)
print("DYNAMIC template keys (manual check):")
for fn, k in dynamic:
    print(f"  {fn}: t(`pages.{k}`)")

# Also find any t() calls with non-string first arg that we might have missed
expr = []
for fn in PAGES:
    s = open(f"{BASE}/pages/{fn}", encoding="utf-8").read()
    for m in re.finditer(r'(\bt\((?!\s*[\'\"`]))', s):
        # capture up to ')'
        pass
print("done")