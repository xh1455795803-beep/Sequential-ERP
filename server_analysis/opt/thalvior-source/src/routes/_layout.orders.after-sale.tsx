import { createFileRoute, Link } from "@tanstack/react-router";
import { DataListPage, type FormField } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/orders/after-sale")({
  component: AfterSale,
});

const columns = [
  { key: "order_id", label: "关联订单" },
  { key: "buyer", label: "买家" },
  { key: "product", label: "商品" },
  { key: "reason", label: "售后原因" },
  { key: "status", label: "状态" },
];

const fields: FormField[] = [
  { key: "order_id", label: "关联订单", required: true, placeholder: "如：TW20260922003" },
  { key: "buyer", label: "买家", placeholder: "如：John Smith" },
  { key: "product", label: "商品", placeholder: "如：无线蓝牙耳机 Pro" },
  { key: "reason", label: "售后原因", placeholder: "如：商品破损 / 退款" },
  { key: "status", label: "状态", type: "select", options: ["待审核", "处理中", "已完成", "已拒绝"] },
];

function AfterSale() {
  return (
    <DataListPage
      title="售后管理"
      description="全生命周期售后处理，保障买家体验"
      table="after_sales"
      columns={columns}
      fields={fields}
      addLabel="新增售后单"
    />
  );
}