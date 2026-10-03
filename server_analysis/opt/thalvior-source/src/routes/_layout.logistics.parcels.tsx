import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/logistics/parcels")({
  component: Page_LogisticsParcels,
});

const columns: ListColumn[] = [
    {key: "parcel_no", label: "包裹号"},
    {key: "waybill_no", label: "运单号"},
    {key: "order_id", label: "订单号"},
    {key: "weight", label: "重量"},
    {key: "length", label: "长"},
    {key: "width", label: "宽"},
    {key: "height", label: "高"},
    {key: "status", label: "状态"},
  ];

const fields: FormField[] = [
    {key: "parcel_no", label: "包裹号", required: true},
    {key: "waybill_no", label: "运单号"},
    {key: "order_id", label: "订单号"},
    {key: "weight", label: "重量", type: "number"},
    {key: "length", label: "长(cm)", type: "number"},
    {key: "width", label: "宽(cm)", type: "number"},
    {key: "height", label: "高(cm)", type: "number"},
    {key: "status", label: "状态", type: "select", options: ["待打包", "已打包", "已出库"]},
  ];

function Page_LogisticsParcels() {
  return (
    <DataListPage
      addLabel="common.add"
      title="包裹管理"
      description="管理发货包裹（待打包/已打包/已出库）"
      table="parcels"
      columns={columns}
      fields={fields}
      exportable
    />
  );
}
