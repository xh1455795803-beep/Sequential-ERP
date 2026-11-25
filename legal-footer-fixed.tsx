import { LEGAL, LEGAL_PLACEHOLDERS, SUPPORT_EMAIL } from "../lib/company";

/** 判断字段是否为未填充的占位符 */
function isPlaceholder(val: string): boolean {
  return !val || LEGAL_PLACEHOLDERS[val as keyof typeof LEGAL_PLACEHOLDERS] === val || val.endsWith("待补）");
}

/** 返回非空、非占位的合规字段（key=展示标签, value=值） */
function legalFields(): { label: string; value: string }[] {
  const raw = [
    { label: "ICP 备案号", value: LEGAL.icpFiling },
    { label: "公安备案号", value: LEGAL.policeFiling },
    { label: "统一社会信用代码", value: LEGAL.uscc },
    { label: "法定代表人", value: LEGAL.legalRepresentative },
    { label: "注册地址", value: LEGAL.registeredAddress },
    { label: "客服电话", value: LEGAL.supportPhone },
  ];
  return raw.filter((f) => !isPlaceholder(f.value));
}

/**
 * 全站合规页脚。
 * — 占位符自动隐藏：未填写的字段（含"待补）"后缀的）不出现在公网页面
 * — 备案号/公司名等合规信息全部落地后会自动渲染
 */
export function LegalFooter({ className = "" }: { className?: string }) {
  const filled = legalFields();
  const hasCompanyName = !isPlaceholder(LEGAL.companyName);
  const email = !isPlaceholder(SUPPORT_EMAIL) ? SUPPORT_EMAIL : null;

  return (
    <footer
      data-testid="legal-footer"
      className={`w-full border-t border-border/60 py-4 md:py-5 px-4 md:px-6 text-center text-xs leading-6 text-muted-foreground ${className}`}
    >
      {/* 品牌版权行 */}
      <div className="mb-1">
        © {new Date().getFullYear()} Thalvior
        {hasCompanyName && <> · {LEGAL.companyName}</>}
        {email && <> · 客服邮箱：<a href={`mailto:${email}`} className="hover:text-foreground">{email}</a></>}
      </div>

      {/* 合规信息行（仅当有已填充的字段时显示） */}
      {filled.length > 0 && (
        <div className="mb-1 text-[11px] opacity-80">
          {filled.map((f, i) => (
            <span key={f.label}>
              {i > 0 && " · "}
              {f.label}：{f.value}
            </span>
          ))}
        </div>
      )}

      {/* 法律链接 */}
      <div className="space-x-3">
        <a className="underline-offset-2 hover:underline" href="/terms">用户服务协议</a>
        <a className="underline-offset-2 hover:underline" href="/privacy">隐私政策</a>
        <a className="underline-offset-2 hover:underline" href="/refund">退款规则</a>
      </div>
    </footer>
  );
}

export default LegalFooter;
