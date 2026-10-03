import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField } from "@/components/data-list-page";

export const Route = createFileRoute("/admin/plans")({
  component: Plans,
});

const columns = [
  { key: "name", label: "套餐名称" },
  { key: "plan_key", label: "套餐标识" },
  { key: "price", label: "价格(元)" },
  { key: "period", label: "周期" },
  { key: "quota", label: "赠送AI额度" },
  { key: "max_shops", label: "店铺上限" },
  { key: "max_products", label: "商品上限" },
  { key: "status", label: "状态" },
];

const fields: FormField[] = [
  { key: "name", label: "套餐名称", required: true, placeholder: "如：专业版" },
  { key: "plan_key", label: "套餐标识", required: true, placeholder: "如：pro_month" },
  { key: "price", label: "价格(元)", type: "number", placeholder: "如：199" },
  { key: "period", label: "周期", type: "select", options: ["月", "年"] },
  { key: "quota", label: "赠送AI额度(元)", type: "number", placeholder: "如：10" },
  { key: "max_shops", label: "店铺数上限", type: "number", placeholder: "-1 表示不限" },
  { key: "max_products", label: "商品数上限", type: "number", placeholder: "-1 表示不限" },
  { key: "description", label: "套餐描述", placeholder: "如：适合中小卖家" },
  { key: "sort_order", label: "排序", type: "number", placeholder: "数字越小越靠前" },
  { key: "status", label: "状态", type: "select", options: ["启用", "停用"] },
];

function Plans() {
  return (
    <DataListPage
      title="订阅套餐管理"
      description="配置会员套餐的价格、赠送 AI 额度与店铺/商品数量上限（改完立即生效）"
      table="subscription_plans"
      columns={columns}
      fields={fields}
      addLabel="新增套餐"
    />
  );
}
