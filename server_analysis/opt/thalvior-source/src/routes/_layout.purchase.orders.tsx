import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/purchase/orders")({
  component: Page_PurchaseOrders,
});

const columns: ListColumn[] = [
    {key: "po_no", label: "采购单号"},
    {key: "supplier_id", label: "供应商ID"},
    {key: "sku", label: "SKU"},
    {key: "name", label: "名称"},
    {key: "qty", label: "数量"},
    {key: "price", label: "单价"},
    {key: "amount", label: "金额"},
    {key: "status", label: "状态"},
    {key: "expect_date", label: "预计到货"},
  ];

const fields: FormField[] = [
    {key: "po_no", label: "采购单号", required: true},
    {key: "supplier_id", label: "供应商ID"},
    {key: "sku", label: "SKU"},
    {key: "name", label: "名称"},
    {key: "qty", label: "数量", type: "number"},
    {key: "price", label: "单价", type: "number"},
    {key: "amount", label: "金额", type: "number"},
    {key: "status", label: "状态", type: "select", options: ["待审核", "采购中", "部分收货", "已完成"]},
    {key: "expect_date", label: "预计到货日期"},
  ];

function Page_PurchaseOrders() {
  return (
    <DataListPage
      addLabel="common.add"
      title="采购订单"
      description="管理采购订单（待审核/采购中/部分收货/已完成）"
      table="purchase_orders"
      columns={columns}
      fields={fields}
      exportable
      batchDelete
    />
  );
}
