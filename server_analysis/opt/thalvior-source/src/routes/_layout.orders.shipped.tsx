import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/orders/shipped")({
  component: Page_OrdersShipped,
});

const columns: ListColumn[] = [
    {key: "id", label: "订单号"},
    {key: "product", label: "商品"},
    {key: "sku", label: "SKU"},
    {key: "buyer", label: "买家"},
    {key: "amount", label: "金额"},
    {key: "currency", label: "币种"},
    {key: "channel", label: "渠道"},
    {key: "status", label: "状态"},
    {key: "created_at", label: "时间"},
  ];

const fields: FormField[] = [
    {key: "product", label: "商品"},
    {key: "sku", label: "SKU"},
    {key: "buyer", label: "买家"},
    {key: "amount", label: "金额", type: "number"},
    {key: "currency", label: "币种"},
    {key: "channel", label: "渠道"},
    {key: "address", label: "地址"},
    {key: "status", label: "状态", type: "select", options: ["待付款", "待处理", "待发货", "部分发货", "已发货", "已完成", "已取消", "异常"]},
  ];

function Page_OrdersShipped() {
  return (
    <DataListPage
      addLabel="common.add"
      title="已发货订单"
      description="状态为「已发货」的订单"
      table="orders"
      columns={columns}
      fields={fields}
      filter={{ field: "status", value: "已发货" }}
      exportable
      batchDelete
    />
  );
}
