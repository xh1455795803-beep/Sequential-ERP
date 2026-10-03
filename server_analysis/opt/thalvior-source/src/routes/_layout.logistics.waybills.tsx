import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/logistics/waybills")({
  component: Page_LogisticsWaybills,
});

const columns: ListColumn[] = [
    {key: "waybill_no", label: "运单号"},
    {key: "carrier", label: "承运商"},
    {key: "tracking_no", label: "追踪号"},
    {key: "weight", label: "重量"},
    {key: "fee", label: "运费"},
    {key: "status", label: "状态"},
  ];

const fields: FormField[] = [
    {key: "waybill_no", label: "运单号", required: true},
    {key: "carrier", label: "承运商"},
    {key: "tracking_no", label: "追踪号"},
    {key: "weight", label: "重量", type: "number"},
    {key: "fee", label: "运费", type: "number"},
    {key: "status", label: "状态", type: "select", options: ["已生成", "已揽收", "运输中", "已签收", "异常"]},
  ];

function Page_LogisticsWaybills() {
  return (
    <DataListPage
      addLabel="common.add"
      title="运单管理"
      description="管理物流运单"
      table="waybills"
      columns={columns}
      fields={fields}
      exportable
    />
  );
}
