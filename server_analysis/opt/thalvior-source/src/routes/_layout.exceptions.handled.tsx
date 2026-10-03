import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/exceptions/handled")({
  component: ExceptionsHandled,
});

const columns: ListColumn[] = [
  { key: "type", label: "类型" },
  { key: "level", label: "级别" },
  { key: "title", label: "标题" },
  { key: "source", label: "来源" },
  { key: "status", label: "状态" },
  { key: "created_at", label: "时间" },
];

const fields: FormField[] = [
  { key: "title", label: "标题", required: true, placeholder: "如：订单 O123 支付失败" },
  { key: "type", label: "类型", type: "select", options: ["订单","库存","采购","物流","售后","财务","平台同步","Webhook","履约"] },
  { key: "level", label: "级别", type: "select", options: ["严重","警告","提示"] },
  { key: "source", label: "来源", placeholder: "如：支付网关" },
  { key: "related_id", label: "关联单号", placeholder: "如：O123" },
  { key: "message", label: "详情", placeholder: "异常描述" },
  { key: "status", label: "状态", type: "select", options: ["待处理","处理中","已解决","已忽略"] },
  { key: "resolved_note", label: "处理说明", placeholder: "处理结论" },
];

function ExceptionsHandled() {
  return (
    <DataListPage
      title="处理记录"
      description="已闭环的异常处理记录"
      table="exceptions"
      columns={columns}
      fields={fields}
      filter={{ field: "status", value: "已解决" }}
      addLabel="上报异常"
      exportable
      batchDelete
    />
  );
}
