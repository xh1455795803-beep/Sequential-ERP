#!/usr/bin/env python3
"""最后 1 项修复 + 再确认"""
import requests

r = requests.get('https://thalvior.icu/', timeout=15)
print('HTTP', r.status_code, 'len=', len(r.text))
print('--- HEAD ---')
print(r.text[:500])
print('--- search assets ---')
idx = r.text.find('assets/')
if idx >= 0:
    print('✅ assets/ found at idx', idx, r.text[idx:idx+40])
else:
    idx2 = r.text.find('.js')
    idx3 = r.text.find('<script')
    print('❌ assets/ not found, .js at', idx2, '<script at', idx3)
