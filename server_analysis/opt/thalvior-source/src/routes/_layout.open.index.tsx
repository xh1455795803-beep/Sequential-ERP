import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { KeyRound, AppWindow, Webhook, ScrollText, ArrowRight, Code2 } from "lucide-react";
import { PageHeader, StatCard } from "@/components/page-header";
import { fetchTable, type ExtRow } from "@/lib/data-access";

export const Route = createFileRoute("/_layout/open/")({
  component: OpenPlatform,
});

const ENTRIES = [
  { to: "/open/keys", icon: KeyRound, title: "API Key", desc: "创建并管理开放接口访问密钥", tone: "primary" as const },
  { to: "/open/apps", icon: AppWindow, title: "应用", desc: "OAuth 第三方应用接入", tone: "success" as const },
  { to: "/open/webhooks", icon: Webhook, title: "Webhook", desc: "订阅事件回调通知", tone: "violet" as const },
  { to: "/open/logs", icon: ScrollText, title: "调用日志", desc: "查看接口调用明细", tone: "warning" as const },
];

function OpenPlatform() {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetchTable("api_keys"),
      fetchTable("oauth_apps"),
      fetchTable("webhooks"),
      fetchTable("api_logs"),
    ])
      .then(([keys, apps, hooks, logs]) => {
        setCounts({
          "API Key": keys.length,
          应用: apps.length,
          Webhook: hooks.length,
          调用日志: logs.length,
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-5">
      <PageHeader
        title="开放平台"
        description="通过 API Key、OAuth 应用与 Webhook 把 Thalvior 能力开放给你的系统"
        actions={
          <Link to="/open/docs" className="inline-flex items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent">
            <Code2 size={15} /> API 文档
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="API Key" value={loading ? "—" : String(counts["API Key"] ?? 0)} icon={<KeyRound size={17} />} tone="primary" />
        <StatCard label="应用" value={loading ? "—" : String(counts["应用"] ?? 0)} icon={<AppWindow size={17} />} tone="success" />
        <StatCard label="Webhook" value={loading ? "—" : String(counts["Webhook"] ?? 0)} icon={<Webhook size={17} />} tone="violet" />
        <StatCard label="调用日志" value={loading ? "—" : String(counts["调用日志"] ?? 0)} icon={<ScrollText size={17} />} tone="warning" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {ENTRIES.map((e) => {
          const Icon = e.icon;
          return (
            <Link
              key={e.to}
              to={e.to}
              className="group flex items-center gap-4 rounded-xl border border-border bg-card p-4 shadow-sm transition-colors hover:border-primary/40 hover:bg-accent/40"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
                <Icon size={20} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink">{e.title}</p>
                <p className="truncate text-sm text-muted-foreground">{e.desc}</p>
              </div>
              <ArrowRight size={18} className="shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
