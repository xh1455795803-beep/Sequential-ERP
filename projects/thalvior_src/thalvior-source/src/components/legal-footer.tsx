import { LEGAL, SUPPORT_EMAIL } from "../lib/company";

/**
 * 全站合规页脚（wave B 20261117）
 * 展示：备案号占位 · 公司主体占位 + 资质信息 + 法务链接。
 * 数据来源只有 src/lib/company.ts 一处；真实值通过 .env 的 VITE_* 注入。
 * 注意：SPA 渲染的内容不会出现在服务端返回的 index.html 源码里；
 *       面向公网的备案展示以 /var/www/landing/index.html 与 /var/www/legal/*.html
 *       这两处静态页为准（已由 wave B 同步写入占位）。
 */
export function LegalFooter({ className = "" }: { className?: string }) {
  return (
    <footer
      data-testid="legal-footer"
      className={`w-full border-t border-border/60 py-4 px-6 text-center text-xs leading-6 text-muted-foreground ${className}`}
    >
      <div>
        {LEGAL.icpFiling} · {LEGAL.companyName}
      </div>
      <div>
        {LEGAL.policeFiling} · 统一社会信用代码：{LEGAL.uscc} · 法定代表人：{LEGAL.legalRepresentative}
      </div>
      <div>注册地址：{LEGAL.registeredAddress} · 客服电话：{LEGAL.supportPhone} · 客服邮箱：{SUPPORT_EMAIL}</div>
      <div className="mt-1 space-x-3">
        <a className="underline-offset-2 hover:underline" href="/terms">用户服务协议</a>
        <a className="underline-offset-2 hover:underline" href="/privacy">隐私政策</a>
        <a className="underline-offset-2 hover:underline" href="/refund">退款规则</a>
      </div>
    </footer>
  );
}

export default LegalFooter;
