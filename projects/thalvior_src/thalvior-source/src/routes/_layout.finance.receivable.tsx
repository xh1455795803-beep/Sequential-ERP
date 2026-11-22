import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

import { tt } from "@/i18n/tts";
export const Route = createFileRoute("/_layout/finance/receivable")({
  component: FinanceReceivablePage,
});

const columns: ListColumn[] = [
  { key: "customer", label: "fin.customer" },
  { key: "invoice_no", label: "fin.docNo" },
  { key: "amount", label: "orders.col.amount" },
  { key: "currency", label: "tools.ship.currency" },
  { key: "due_date", label: "fin.expireDate" },
  { key: "status", label: "common.statusLabel" }
];

const fields: FormField[] = [
  { key: "customer", label: "fin.customer", required: true },
  { key: "invoice_no", label: "fin.docNo" },
  { key: "amount", label: "orders.col.amount", type: "number", required: true },
  { key: "currency", label: "tools.ship.currency", type: "select", options: ["CNY", "USD", "EUR", "GBP", "JPY"] },
  { key: "due_date", label: "fin.expireDate" },
  { key: "status", label: "common.statusLabel", type: "select", options: [{ label: "st.recvNone", value: "未收" }, { label: "st.recvPart", value: "部分已收" }, { label: "st.recvDone", value: "已收" }, { label: "st.overdue", value: "逾期" }] },
  { key: "note", label: "sub.usage.col.note" }
];

function FinanceReceivablePage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="nav.finance.receivable"
      description="fin.receivableDesc"
      table="receivables"
      columns={columns}
      fields={fields}
    />
  );
}
