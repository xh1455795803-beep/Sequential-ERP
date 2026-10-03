import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/orders/rule-inactive")({
  component: Page_OrdersRuleInactive,
});

const columns: ListColumn[] = [
    {key: "id", label: "规则ID"},
    {key: "name", label: "名称"},
    {key: "condition", label: "条件"},
    {key: "action", label: "动作"},
    {key: "status", label: "状态"},
  ];

const fields: FormField[] = [
    {key: "name", label: "名称", required: true},
    {key: "condition", label: "条件"},
    {key: "action", label: "动作"},
    {key: "status", label: "状态", type: "select", options: ["启用", "停用"]},
  ];

function Page_OrdersRuleInactive() {
  return (
    <DataListPage
      addLabel="common.add"
      title="审单规则-停用"
      description="状态为「停用」的审单规则"
      table="order_rules"
      columns={columns}
      fields={fields}
      filter={{ field: "status", value: "停用" }}
      exportable
      batchDelete
    />
  );
}
