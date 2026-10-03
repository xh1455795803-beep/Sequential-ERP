import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/finance/receivable")({
  component: FinanceReceivablePage,
});

const columns: ListColumn[] = [
  { key: "customer", label: "客户" },
  { key: "invoice_no", label: "单据号" },
  { key: "amount", label: "金额" },
  { key: "currency", label: "币种" },
  { key: "due_date", label: "到期日" },
  { key: "status", label: "状态" }
];

const fields: FormField[] = [
  { key: "customer", label: "客户", required: true },
  { key: "invoice_no", label: "单据号" },
  { key: "amount", label: "金额", type: "number", required: true },
  { key: "currency", label: "币种", type: "select", options: ["CNY", "USD", "EUR", "GBP", "JPY"] },
  { key: "due_date", label: "到期日" },
  { key: "status", label: "状态", type: "select", options: ["未收", "部分已收", "已收", "逾期"] },
  { key: "note", label: "备注" }
];

function FinanceReceivablePage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="应收管理"
      description="应收账款登记与回款跟踪"
      table="receivables"
      columns={columns}
      fields={fields}
    />
  );
}
