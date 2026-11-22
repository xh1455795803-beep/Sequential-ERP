import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

import { tt } from "@/i18n/tts";
export const Route = createFileRoute("/_layout/purchase/returns")({
  component: Page_PurchaseReturns,
});

const columns: ListColumn[] = [
    {key: "return_no", label: "pur.inbound.retColNo"},
    {key: "po_no", label: "po.col.no"},
    {key: "supplier_id", label: "pur.supplierId"},
    {key: "sku", label: "SKU"},
    {key: "qty", label: "outbound.qty"},
    {key: "reason", label: "exc.reason"},
    {key: "status", label: "common.statusLabel"},
  ];

const fields: FormField[] = [
    {key: "return_no", label: "pur.inbound.retColNo", required: true},
    {key: "po_no", label: "po.col.no"},
    {key: "supplier_id", label: "pur.supplierId"},
    {key: "sku", label: "SKU"},
    {key: "qty", label: "outbound.qty", type: "number"},
    {key: "reason", label: "exc.reason"},
    {key: "status", label: "common.statusLabel", type: "select", options: [{ label: "st.pending", value: "待处理" }, { label: "st.received", value: "已收货" }, { label: "st.returned", value: "已退款" }, { label: "st.rejected", value: "已拒绝" }]},
  ];

function Page_PurchaseReturns() {
  return (
    <DataListPage
      addLabel="common.add"
      title="nav.purchase.returns"
      description="pur.returnsDesc"
      table="purchase_returns"
      columns={columns}
      fields={fields}
      exportable
      batchDelete
    />
  );
}
