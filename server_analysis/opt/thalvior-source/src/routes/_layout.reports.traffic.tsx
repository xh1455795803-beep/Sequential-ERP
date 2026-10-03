import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/reports/traffic")({
  component: Traffic,
});

const columns = [
  { key: "channel", label: "流量渠道" },
  { key: "visits", label: "访问量" },
  { key: "orders", label: "订单数" },
  { key: "conversion", label: "转化率" },
];

const fields: FormField[] = [
  { key: "channel", label: "流量渠道", required: true, placeholder: "如：自然搜索" },
  { key: "visits", label: "访问量", type: "number", placeholder: "如：18200" },
  { key: "orders", label: "订单数", type: "number", placeholder: "如：420" },
  { key: "conversion", label: "转化率", type: "number", placeholder: "如：2.3" },
];

function Traffic() {
  return (
    <DataListPage
      title="流量分析"
      description="流量来源与转化分析"
      table="traffic_stats"
      columns={columns}
      fields={fields}
      addLabel="新增记录"
      exportable
    />
  );
}