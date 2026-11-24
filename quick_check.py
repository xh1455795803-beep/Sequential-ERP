#!/usr/bin/env python3
"""简单版：只看 HTML + CSS 头部"""
import requests
r = requests.get('https://thalvior.icu/erp/', timeout=10)
print('HTTP', r.status_code, 'len=', len(r.text))
print(r.text[:500])
print('---')
# 只拿 CSS 不拿 JS
import re
m = re.search(r'href="(/assets/[^"]+\.css)"', r.text)
if m:
    css = requests.get('https://thalvior.icu' + m.group(1), timeout=10).text
    print('CSS len:', len(css))
    for kw in ['.glass', 'blob', 'backdrop-blur', 'radial-gradient', 'mint-', 'coral-', 'lilac-']:
        print(('✅' if kw in css else '❌') + ' ' + kw)
