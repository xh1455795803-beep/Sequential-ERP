import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/finance/cost")({
  component: FinanceCostPage,
});

const columns: ListColumn[] = [
  { key: "date", label: "日期" },
  { key: "category", label: "类别" },
  { key: "amount", label: "金额" },
  { key: "currency", label: "币种" },
  { key: "note", label: "备注" }
];

const fields: FormField[] = [
  { key: "date", label: "日期" },
  { key: "category", label: "类别", type: "select", options: ["采购", "物流", "广告", "仓储", "平台佣金", "其他"] },
  { key: "amount", label: "金额", type: "number", required: true },
  { key: "currency", label: "币种", type: "select", options: ["CNY", "USD", "EUR", "GBP", "JPY"] },
  { key: "note", label: "备注" }
];

function FinanceCostPage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="成本管理"
      description="采购 / 物流 / 广告 / 仓储等成本登记"
      table="cost_records"
      columns={columns}
      fields={fields}
    />
  );
}
