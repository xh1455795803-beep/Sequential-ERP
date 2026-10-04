#!/usr/bin/env python3
"""精准修复 handleSave — 删残留、补闭合、保大括号平衡"""
with open("src/routes/_layout.auth.index.tsx") as f:
    lines = f.readlines()

finally_end = residual_start = handle_delete_start = None
for i, l in enumerate(lines):
    if l.rstrip() == "    }" and i > 380 and "setSaving(false)" in lines[i-1]:
        finally_end = i
        residual_start = i + 1
    if "const handleDelete = async" in l:
        handle_delete_start = i
        break

print(f"finally_end={finally_end}, residual_start={residual_start}, handle_delete={handle_delete_start}")

if finally_end and residual_start and handle_delete_start:
    new_lines = (
        lines[:finally_end+1]
        + ["  };\n", "\n"]
        + lines[handle_delete_start:]
    )
    with open("src/routes/_layout.auth.index.tsx", "w") as f:
        f.writelines(new_lines)
    print(f"✅ 删 {handle_delete_start - residual_start} 行残留，补闭合")
else:
    print("❌ 定位失败")
