import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/orders/aftersale-rejected")({
  component: Page_OrdersAftersaleRejected,
});

const columns: ListColumn[] = [
    {key: "id", label: "售后单"},
    {key: "order_id", label: "订单号"},
    {key: "product", label: "商品"},
    {key: "buyer", label: "买家"},
    {key: "amount", label: "金额"},
    {key: "reason", label: "原因"},
    {key: "status", label: "状态"},
    {key: "created_at", label: "时间"},
  ];

const fields: FormField[] = [
    {key: "order_id", label: "订单号"},
    {key: "product", label: "商品"},
    {key: "buyer", label: "买家"},
    {key: "amount", label: "金额", type: "number"},
    {key: "reason", label: "原因"},
    {key: "status", label: "状态", type: "select", options: ["待处理", "处理中", "已完成", "已拒绝"]},
  ];

function Page_OrdersAftersaleRejected() {
  return (
    <DataListPage
      addLabel="common.add"
      title="售后-已拒绝"
      description="状态为「已拒绝」的售后单"
      table="after_sales"
      columns={columns}
      fields={fields}
      filter={{ field: "status", value: "已拒绝" }}
      exportable
      batchDelete
    />
  );
}
