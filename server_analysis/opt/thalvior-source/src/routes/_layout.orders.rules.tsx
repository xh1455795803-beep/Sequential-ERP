import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/orders/rules")({
  component: Rules,
});

const columns = [
  { key: "name", label: "规则名称" },
  { key: "condition", label: "触发条件" },
  { key: "action", label: "执行动作" },
  { key: "status", label: "状态" },
];

const fields: FormField[] = [
  { key: "name", label: "规则名称", required: true, placeholder: "如：高风险订单拦截" },
  { key: "condition", label: "触发条件", required: true, placeholder: "如：金额 > $500" },
  { key: "action", label: "执行动作", required: true, placeholder: "如：转人工审核" },
  { key: "status", label: "状态", type: "select", options: ["启用", "停用"] },
];

function Rules() {
  return (
    <DataListPage
      title="审单规则"
      description="智能审单规则配置，提升订单处理效率"
      table="order_rules"
      columns={columns}
      fields={fields}
      addLabel="新建规则"
    />
  );
}