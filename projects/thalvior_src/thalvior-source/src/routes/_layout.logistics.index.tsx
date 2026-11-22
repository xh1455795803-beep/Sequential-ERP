// 货代管理（/logistics）：五个 tab 全部真读真写生产库
// 数据出入口统一走 @/lib/data-access；文案统一走 tt("fw.*")（词条见 src/i18n/extra.fw.ts）
// 原硬编码名录常量已彻底删除：目录数据只来自 forwarder_catalog 表
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Boxes, Plug, ShieldCheck, ToggleRight, Warehouse } from "lucide-react";
import { PageHeader, StatCard } from "@/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { tt } from "@/i18n/tts";
import { queryTable, type TableFilter } from "@/lib/data-access";
import {
  EmptyState,
} from "@/components/empty-state";
import {
  useAsyncData,
} from "@/components/forwarder/common";
import { ForwarderPanel } from "@/components/forwarder/ForwarderPanel";
import { AuthPanel } from "@/components/forwarder/AuthPanel";
import { WarehousePanel } from "@/components/forwarder/WarehousePanel";
import { CatalogPanel } from "@/components/forwarder/CatalogPanel";
import { SwitchPanel } from "@/components/forwarder/SwitchPanel";

export const Route = createFileRoute("/_layout/logistics/")({
  component: ForwarderPage,
});

type Tab = "forwarders" | "auth" | "warehouse" | "catalog" | "switch";

const TABS: { id: Tab; labelKey: string; icon: React.ReactNode }[] = [
  { id: "forwarders", labelKey: "fw.tab.forwarders", icon: <Warehouse size={14} /> },
  { id: "auth", labelKey: "fw.tab.auth", icon: <ShieldCheck size={14} /> },
  { id: "warehouse", labelKey: "fw.tab.warehouse", icon: <Boxes size={14} /> },
  { id: "catalog", labelKey: "fw.tab.catalog", icon: <Plug size={14} /> },
  { id: "switch", labelKey: "fw.tab.switch", icon: <ToggleRight size={14} /> },
];

// 顶部统计：五条服务端 count 查询（limit 1 + count exact），不把四张表全量拉到前端再数
async function countWhere(table: string, filters?: TableFilter[]): Promise<number> {
  const res = await queryTable(table, { filters, limit: 1, count: "exact" });
  return res.count ?? res.rows.length;
}

function useSummary() {
  return useAsyncData(
    async () => ({
      forwarders: await countWhere("freight_forwarders", [{ field: "is_deleted", value: "false" }]),
      ready: await countWhere("freight_forwarders", [
        { field: "is_deleted", value: "false" },
        { field: "available_state", value: "available" },
      ]),
      authorized: await countWhere("forwarder_auths", [
        { field: "auth_state", value: ["approved", "authorized"], op: "in" },
      ]),
      warehouses: await countWhere("forwarder_warehouses"),
      switches: await countWhere("fulfillment_switches"),
    }),
    [],
    { forwarders: 0, ready: 0, authorized: 0, warehouses: 0, switches: 0 },
  );
}

function ForwarderPage() {
  const [tab, setTab] = useState<Tab>("forwarders");
  const { data: sum, loading, error } = useSummary();

  const stats: { label: string; value: string; icon: React.ReactNode; tone: "primary" | "success" | "warning" | "violet" | "blue" }[] = [
    { label: tt("fw.stat.forwarders"), value: loading ? "—" : String(sum.forwarders), icon: <Warehouse size={17} />, tone: "primary" },
    { label: tt("fw.stat.ready"), value: loading ? "—" : String(sum.ready), icon: <ShieldCheck size={17} />, tone: "success" },
    { label: tt("fw.stat.authorized"), value: loading ? "—" : String(sum.authorized), icon: <Plug size={17} />, tone: "blue" },
    { label: tt("fw.stat.warehouses"), value: loading ? "—" : String(sum.warehouses), icon: <Boxes size={17} />, tone: "warning" },
    { label: tt("fw.stat.switches"), value: loading ? "—" : String(sum.switches), icon: <ToggleRight size={17} />, tone: "violet" },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title={tt("fw.page.title")} description={tt("fw.page.desc")} />

      {error ? (
        <EmptyState text={tt("fw.ui.loadFail")} hint={error} iconSize={28} />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          {stats.map((s) => (
            <StatCard key={s.label} label={s.label} value={s.value} icon={s.icon} tone={s.tone} />
          ))}
        </div>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="flex-wrap h-auto">
          {TABS.map((t) => (
            <TabsTrigger key={t.id} value={t.id} className="gap-1.5">
              {t.icon}
              {tt(t.labelKey)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="forwarders" className="mt-4">
          <ForwarderPanel />
        </TabsContent>
        <TabsContent value="auth" className="mt-4">
          <AuthPanel />
        </TabsContent>
        <TabsContent value="warehouse" className="mt-4">
          <WarehousePanel />
        </TabsContent>
        <TabsContent value="catalog" className="mt-4">
          <CatalogPanel />
        </TabsContent>
        <TabsContent value="switch" className="mt-4">
          <SwitchPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
