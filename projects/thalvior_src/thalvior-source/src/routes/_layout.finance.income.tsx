import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

import { tt } from "@/i18n/tts";
export const Route = createFileRoute("/_layout/finance/income")({
  component: FinanceIncomePage,
});

const columns: ListColumn[] = [
  { key: "date", label: "common.date" },
  { key: "platform", label: "collect.platformCol" },
  { key: "shop", label: "adm.plat.shopShort" },
  { key: "order_no", label: "orders.col.orderNo" },
  { key: "amount", label: "orders.col.amount" },
  { key: "currency", label: "tools.ship.currency" },
  { key: "type", label: "common.type" },
  { key: "status", label: "common.statusLabel" }
];

const fields: FormField[] = [
  { key: "date", label: "common.date" },
  { key: "platform", label: "collect.platformCol" },
  { key: "shop", label: "adm.plat.shopShort" },
  { key: "order_no", label: "orders.col.orderNo" },
  { key: "amount", label: "orders.col.amount", type: "number", required: true },
  { key: "currency", label: "tools.ship.currency", type: "select", options: ["CNY", "USD", "EUR", "GBP", "JPY"] },
  { key: "type", label: "common.type", type: "select", options: [{ label: "fin.salesIncome", value: "销售收入" }, { label: "fin.catRefundOffset", value: "退款冲减" }, { label: "fin.catOtherIncome", value: "其他收入" }] },
  { key: "status", label: "common.statusLabel", type: "select", options: [{ label: "st.confirmed", value: "已确认" }, { label: "st.unconfirmed", value: "待确认" }] },
  { key: "note", label: "sub.usage.col.note" }
];

function FinanceIncomePage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="nav.finance.income"
      description="fin.incomeDesc"
      table="income_records"
      columns={columns}
      fields={fields}
    />
  );
}
