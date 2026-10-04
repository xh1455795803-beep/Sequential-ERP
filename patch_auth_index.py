#!/usr/bin/env python3
"""把 auth index.tsx 从旧 Edge Function 调用统一切到 authorize-shop，去掉 Tabs。"""
import re

with open("src/routes/_layout.auth.index.tsx", "r") as f:
    src = f.read()

# 1) import: 加 saveManualAuth，去掉 AuthSourcePage
src = src.replace(
    'import { getOAuthUrl } from "@/services/shopOAuth";',
    'import { getOAuthUrl, saveManualAuth } from "@/services/shopOAuth";'
)
src = src.replace(
    'import { AuthSourcePage } from "@/components/auth-source-page";',
    '// AuthSourcePage 已合并到 AuthShopTab（authorize-shop 统一入口）'
)

# 2) handleSave: 替换整个 fetch verify-shop-auth 块为 saveManualAuth 调用
old_fetch = '''    setSaving(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const res = await fetch(`${supabaseUrl}/functions/v1/verify-shop-auth`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          action: "save",
          shop_name: form.shop_name.trim(),
          platform: form.platform,
          region: form.region.trim(),
          credentials: form.creds,
        }),
      });
      const data = await res.json();'''

new_fetch = '''    setSaving(true);
    try {
      const data = await saveManualAuth({
        shop_name: form.shop_name.trim(),
        platform: form.platform,
        region: form.region.trim(),
        credentials: form.creds,
      });'''

if old_fetch in src:
    src = src.replace(old_fetch, new_fetch)
    print("✅ handleSave → saveManualAuth")
else:
    print("⚠️  handleSave fetch 片段不匹配（可能空格不同），用正则兜底")
    # 找 setSaving(true) 后紧跟的 fetch verify-shop-auth 块
    pattern = re.compile(
        r'(    setSaving\(true\);\s*try \{\s*const session =.*?supabase\.auth\.getSession\(\).*?\s*'
        r'const res = await fetch\(\$\{supabaseUrl\}/functions/v1/verify-shop-auth.*?\s*'
        r'const data = await res\.json\(\);)',
        re.DOTALL
    )
    m = pattern.search(src)
    if m:
        src = src.replace(m.group(1), new_fetch)
        print("✅ 正则兜底成功")
    else:
        print("❌ 正则也没匹配到，手动处理")

# 3) 去掉 Tabs → AuthShopTab 直接渲染
old_tabs = '''function AuthCenter() {
  const { t } = useLanguage();
  return (
    <div className="space-y-5">
      <PageHeader title={t("auth.centerTitle")} description={t("auth.centerDesc")} />
      <Tabs defaultValue="shop">
        <TabsList>
          <TabsTrigger value="shop">{t("auth.tabShop")}</TabsTrigger>
          <TabsTrigger value="source">{t("auth.tabSource")}</TabsTrigger>
        </TabsList>
        <TabsContent value="shop" className="space-y-5">
          <AuthShopTab />
        </TabsContent>
        <TabsContent value="source" className="space-y-5">
          <AuthSourcePage />
        </TabsContent>
      </Tabs>
    </div>
  );
}'''

new_tabs = '''function AuthCenter() {
  const { t } = useLanguage();
  return (
    <div className="space-y-5">
      <PageHeader title={t("auth.centerTitle")} description={t("auth.centerDesc")} />
      <AuthShopTab />
    </div>
  );
}'''

if old_tabs in src:
    src = src.replace(old_tabs, new_tabs)
    print("✅ Tabs 去掉，AuthShopTab 直接渲染")
else:
    print("⚠️ Tabs 片段不完全匹配")

# 4) 清理不再需要的 import（Tabs/TabsContent/TabsList/TabsTrigger 可能还被 AuthShopTab 用，保留）

with open("src/routes/_layout.auth.index.tsx", "w") as f:
    f.write(src)

print("\n🎉 src/routes/_layout.auth.index.tsx 写回成功")
