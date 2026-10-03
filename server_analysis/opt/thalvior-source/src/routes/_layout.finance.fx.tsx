import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/finance/fx")({
  component: FinanceFxPage,
});

const columns: ListColumn[] = [
  { key: "currency", label: "币种" },
  { key: "rate", label: "对人民币汇率" },
  { key: "date", label: "生效日期" },
  { key: "note", label: "备注" }
];

const fields: FormField[] = [
  { key: "currency", label: "币种", type: "select", options: ["USD", "EUR", "GBP", "JPY", "AUD", "CAD"], required: true },
  { key: "rate", label: "对人民币汇率", type: "number", required: true },
  { key: "date", label: "生效日期" },
  { key: "note", label: "备注" }
];

function FinanceFxPage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="汇率管理"
      description="多币种对人民币汇率维护（用于汇兑换算）"
      table="fx_rates"
      columns={columns}
      fields={fields}
    />
  );
}
