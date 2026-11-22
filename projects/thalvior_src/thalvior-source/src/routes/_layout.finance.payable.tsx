import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

import { tt } from "@/i18n/tts";
export const Route = createFileRoute("/_layout/finance/payable")({
  component: FinancePayablePage,
});

const columns: ListColumn[] = [
  { key: "supplier", label: "common.supplier" },
  { key: "invoice_no", label: "fin.docNo" },
  { key: "amount", label: "orders.col.amount" },
  { key: "currency", label: "tools.ship.currency" },
  { key: "due_date", label: "fin.expireDate" },
  { key: "status", label: "common.statusLabel" }
];

const fields: FormField[] = [
  { key: "supplier", label: "common.supplier", required: true },
  { key: "invoice_no", label: "fin.docNo" },
  { key: "amount", label: "orders.col.amount", type: "number", required: true },
  { key: "currency", label: "tools.ship.currency", type: "select", options: ["CNY", "USD", "EUR", "GBP", "JPY"] },
  { key: "due_date", label: "fin.expireDate" },
  { key: "status", label: "common.statusLabel", type: "select", options: [{ label: "st.unpaid", value: "未付" }, { label: "st.partialPaid", value: "部分已付" }, { label: "st.paid", value: "已付" }, { label: "st.overdue", value: "逾期" }] },
  { key: "note", label: "sub.usage.col.note" }
];

function FinancePayablePage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="nav.finance.payable"
      description="fin.payableDesc"
      table="payables"
      columns={columns}
      fields={fields}
    />
  );
}
