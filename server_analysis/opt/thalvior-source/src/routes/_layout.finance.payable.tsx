import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/finance/payable")({
  component: FinancePayablePage,
});

const columns: ListColumn[] = [
  { key: "supplier", label: "供应商" },
  { key: "invoice_no", label: "单据号" },
  { key: "amount", label: "金额" },
  { key: "currency", label: "币种" },
  { key: "due_date", label: "到期日" },
  { key: "status", label: "状态" }
];

const fields: FormField[] = [
  { key: "supplier", label: "供应商", required: true },
  { key: "invoice_no", label: "单据号" },
  { key: "amount", label: "金额", type: "number", required: true },
  { key: "currency", label: "币种", type: "select", options: ["CNY", "USD", "EUR", "GBP", "JPY"] },
  { key: "due_date", label: "到期日" },
  { key: "status", label: "状态", type: "select", options: ["未付", "部分已付", "已付", "逾期"] },
  { key: "note", label: "备注" }
];

function FinancePayablePage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="应付管理"
      description="应付账款登记与付款跟踪"
      table="payables"
      columns={columns}
      fields={fields}
    />
  );
}
