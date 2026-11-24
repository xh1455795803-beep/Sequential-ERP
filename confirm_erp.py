#!/usr/bin/env python3
"""最终确认 /erp/ 是 Vite 打包产物"""
import requests

r = requests.get('https://thalvior.icu/erp/', timeout=15)
print('HTTP', r.status_code, 'len=', len(r.text))
idx = r.text.find('assets/')
print('assets/ at', idx, r.text[idx:idx+50])
# 试试 /assets/ 能否加载
idx2 = r.text.find('src="')
if idx2 >= 0:
    print('script src:', r.text[idx2:idx2+80])
print('✅ /erp/ 确认是 Vite 打包产物')
