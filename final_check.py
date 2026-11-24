#!/usr/bin/env python3
"""最终看 /erp/ 效果 + CSS"""
import requests

print('=== /erp/ HTML ===')
r = requests.get('https://thalvior.icu/erp/', timeout=15)
print('HTTP', r.status_code, 'len=', len(r.text))

# 找 CSS asset
import re
css_match = re.search(r'href="(/assets/[^"]+\.css)"', r.text)
js_match = re.search(r'src="(/assets/[^"]+\.js)"', r.text)

if css_match:
    css_url = 'https://thalvior.icu' + css_match.group(1)
    print('\n=== CSS 文件 ===')
    print('URL:', css_url)
    r2 = requests.get(css_url, timeout=15)
    print('HTTP', r2.status_code, 'len=', len(r2.text))
    
    # 检查新样式是否在
    checks = {
        'glass 类': '.glass',
        'backdrop-blur': 'backdrop-blur',
        'blob': '.blob',
        'soft pastel mint': 'mint-',
        'coral pastel': 'coral-',
        'lilac pastel': 'lilac-',
        '柔和渐变 body': 'radial-gradient',
        'float-anim': 'float-anim',
        'TrendingUp 图标': 'TrendingUp',
        'Dashboard 问候': '你好',
    }
    print('\n=== CSS / JS 内容检查 ===')
    for label, pattern in checks.items():
        found = pattern in r2.text.lower() or pattern in (js_match.group(1) if js_match else '')
        # 也检查 js
        js_text = ''
        if js_match:
            r3 = requests.get('https://thalvior.icu' + js_match.group(1), timeout=15)
            js_text = r3.text
        found2 = pattern in js_text.lower()
        print('  ' + ('✅' if (found or found2) else '❌') + ' ' + label)

if js_match:
    print('\nJS:', js_match.group(1))
