lines = open("src/routes/_layout.auth.index.tsx").readlines()

# 找 handleSave 里 finally 的结束（setSaving(false) 下一行是 "    }"）
for i, l in enumerate(lines):
    if "setSaving(false)" in l and i+1 < len(lines) and lines[i+1].rstrip() == "    }":
        # 这应该是 finally 的 }
        # 行 i+2 应该是 "  };" 或者紧跟着 handleDelete
        if i+2 < len(lines) and lines[i+2].strip() != "};" and "const handleDelete" not in lines[i+2]:
            # 需要补闭合
            lines.insert(i+2, "  };\n\n")
            print(f"✅ 在第 {i+3} 行补了 handleSave 闭合")
            break
        elif "const handleDelete" in lines[i+2]:
            # 直接跳到 handleDelete 了，肯定缺闭合
            lines.insert(i+2, "  };\n\n")
            print(f"✅ 在第 {i+3} 行补了 handleSave 闭合（直接跳 handleDelete）")
            break
        else:
            print(f"第 {i+2} 行已经是 }};")
            break
else:
    print("❌ 没找到 finally setSaving(false)")

# 大括号平衡
depth = 0
for l in lines:
    depth += l.count("{") - l.count("}")
print(f"final brace depth = {depth} (should be 0)")
if depth > 0:
    lines.append("\n" + "}" * depth + "\n")
    print(f"⚠️  末尾补了 {depth} 个 }}")

open("src/routes/_layout.auth.index.tsx", "w").writelines(lines)
print("✅ 写回完成")
