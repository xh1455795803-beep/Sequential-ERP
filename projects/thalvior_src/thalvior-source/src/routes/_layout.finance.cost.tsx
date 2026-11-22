import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

import { tt } from "@/i18n/tts";
export const Route = createFileRoute("/_layout/finance/cost")({
  component: FinanceCostPage,
});

const columns: ListColumn[] = [
  { key: "date", label: "common.date" },
  { key: "category", label: "common.category" },
  { key: "amount", label: "orders.col.amount" },
  { key: "currency", label: "tools.ship.currency" },
  { key: "note", label: "sub.usage.col.note" }
];

const fields: FormField[] = [
  { key: "date", label: "common.date" },
  { key: "category", label: "common.category", type: "select", options: [{ label: "exc.catPurchase", value: "采购" }, { label: "exc.catLogistics", value: "物流" }, { label: "fin.catAds", value: "广告" }, { label: "fin.catStorage", value: "仓储" }, { label: "fee.account.platform.commission", value: "平台佣金" }, { label: "common.other", value: "其他" }] },
  { key: "amount", label: "orders.col.amount", type: "number", required: true },
  { key: "currency", label: "tools.ship.currency", type: "select", options: ["CNY", "USD", "EUR", "GBP", "JPY"] },
  { key: "note", label: "sub.usage.col.note" }
];

function FinanceCostPage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="nav.finance.cost"
      description="fin.costDesc"
      table="cost_records"
      columns={columns}
      fields={fields}
    />
  );
}
