import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/exceptions/fulfillment")({
  component: Page_ExceptionsFulfillment,
});

const columns: ListColumn[] = [
    {key: "level", label: "级别"},
    {key: "title", label: "标题"},
    {key: "source", label: "来源"},
    {key: "status", label: "状态"},
    {key: "created_at", label: "时间"},
  ];

const fields: FormField[] = [
    {key: "title", label: "标题", required: true},
    {key: "type", label: "类型", type: "select", options: ["订单", "库存", "采购", "物流", "售后", "财务", "平台同步", "Webhook", "履约"]},
    {key: "level", label: "级别", type: "select", options: ["严重", "警告", "提示"]},
    {key: "source", label: "来源"},
    {key: "related_id", label: "关联单号"},
    {key: "message", label: "详情"},
    {key: "status", label: "状态", type: "select", options: ["待处理", "处理中", "已解决", "已忽略"]},
    {key: "resolved_note", label: "处理说明"},
  ];

function Page_ExceptionsFulfillment() {
  return (
    <DataListPage
      title="履约异常"
      description="查看并处理履约类异常"
      table="exceptions"
      columns={columns}
      fields={fields}
      filter={{ field: "type", value: "履约" }}
      addLabel="上报异常"
      exportable
      batchDelete
    />
  );
}
