import { createFileRoute, Link } from "@tanstack/react-router";
import { KeyRound, ShieldCheck, Webhook } from "lucide-react";
import { PageHeader } from "@/components/page-header";

export const Route = createFileRoute("/_layout/open/docs")({
  component: ApiDocs,
});

const ENDPOINTS = [
  { method: "GET", path: "/v1/orders", desc: "获取订单列表（支持 status / page / pageSize 过滤）" },
  { method: "POST", path: "/v1/orders/:id/ship", desc: "标记订单发货" },
  { method: "GET", path: "/v1/inventory", desc: "查询 SKU 库存" },
  { method: "GET", path: "/v1/products", desc: "查询商品列表" },
  { method: "POST", path: "/v1/webhooks", desc: "注册事件回调（同 Webhook 管理）" },
];

function Badge({ method }: { method: string }) {
  const color =
    method === "GET" ? "border-emerald-200 bg-emerald-50 text-emerald-600" :
    method === "POST" ? "border-blue-200 bg-blue-50 text-blue-600" :
    "border-violet-200 bg-violet-50 text-violet-600";
  return <span className={`inline-flex rounded border px-2 py-0.5 text-xs font-semibold ${color}`}>{method}</span>;
}

function ApiDocs() {
  return (
    <div className="space-y-6">
      <PageHeader title="API 文档" description="Thalvior 开放接口使用说明（RESTful / JSON）" />

      <section className="space-y-3 rounded-xl border border-border bg-card p-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-base font-semibold"><KeyRound size={17} /> 认证</h2>
        <p className="text-sm text-muted-foreground">
          所有请求需在 Header 携带 <code className="rounded bg-muted px-1.5 py-0.5 text-xs">Authorization: Bearer &lt;API Key&gt;</code>。密钥在
          <Link to="/open/keys" className="mx-1 text-primary underline-offset-2 hover:underline">API Key</Link>
          管理中创建，按 scope（read / write / admin）控制权限范围。
        </p>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-base font-semibold"><ShieldCheck size={17} /> 权限范围</h2>
        <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
          <li><b className="text-foreground">read</b>：只读访问订单 / 库存 / 商品等数据</li>
          <li><b className="text-foreground">write</b>：可读写业务数据（含发货、建单）</li>
          <li><b className="text-foreground">admin</b>：含租户级配置与 Webhook 管理</li>
        </ul>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-base font-semibold"><Webhook size={17} /> 事件回调</h2>
        <p className="text-sm text-muted-foreground">
          通过 <Link to="/open/webhooks" className="mx-1 text-primary underline-offset-2 hover:underline">Webhook</Link> 订阅 <code className="rounded bg-muted px-1.5 py-0.5 text-xs">order.created / order.paid / order.shipped / inventory.low / exception.raised</code> 等事件，回调使用 secret 签名校验，确保来源可信。
        </p>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-5 shadow-sm">
        <h2 className="text-base font-semibold">主要端点</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">方法</th>
                <th className="px-3 py-2 font-medium">路径</th>
                <th className="px-3 py-2 font-medium">说明</th>
              </tr>
            </thead>
            <tbody>
              {ENDPOINTS.map((e) => (
                <tr key={e.path} className="border-b border-border last:border-0">
                  <td className="px-3 py-2.5"><Badge method={e.method} /></td>
                  <td className="px-3 py-2.5 font-mono text-xs">{e.path}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{e.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
