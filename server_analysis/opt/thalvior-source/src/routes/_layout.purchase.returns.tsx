import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/purchase/returns")({
  component: Page_PurchaseReturns,
});

const columns: ListColumn[] = [
    {key: "return_no", label: "退货单号"},
    {key: "po_no", label: "采购单号"},
    {key: "supplier_id", label: "供应商ID"},
    {key: "sku", label: "SKU"},
    {key: "qty", label: "数量"},
    {key: "reason", label: "原因"},
    {key: "status", label: "状态"},
  ];

const fields: FormField[] = [
    {key: "return_no", label: "退货单号", required: true},
    {key: "po_no", label: "采购单号"},
    {key: "supplier_id", label: "供应商ID"},
    {key: "sku", label: "SKU"},
    {key: "qty", label: "数量", type: "number"},
    {key: "reason", label: "原因"},
    {key: "status", label: "状态", type: "select", options: ["待处理", "已收货", "已退款", "已拒绝"]},
  ];

function Page_PurchaseReturns() {
  return (
    <DataListPage
      addLabel="common.add"
      title="采购退货"
      description="管理采购退货单"
      table="purchase_returns"
      columns={columns}
      fields={fields}
      exportable
      batchDelete
    />
  );
}
