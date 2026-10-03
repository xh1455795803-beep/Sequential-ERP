import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/logistics/reconcile")({
  component: Page_LogisticsReconcile,
});

const columns: ListColumn[] = [
    {key: "bill_no", label: "账单号"},
    {key: "amount", label: "金额"},
    {key: "status", label: "状态"},
    {key: "created_at", label: "时间"},
  ];

const fields: FormField[] = [
    {key: "bill_no", label: "账单号", required: true},
    {key: "amount", label: "金额", type: "number"},
    {key: "status", label: "状态", type: "select", options: ["待对账", "已对账", "差异"]},
  ];

function Page_LogisticsReconcile() {
  return (
    <DataListPage
      addLabel="common.add"
      title="物流对账"
      description="物流费用对账（待对账/已对账/差异）"
      table="reconciliations"
      columns={columns}
      fields={fields}
      exportable
    />
  );
}
