import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/orders/settings")({
  component: Page_OrdersSettings,
});

const columns: ListColumn[] = [
    {key: "key", label: "配置项"},
    {key: "value", label: "值"},
    {key: "description", label: "说明"},
    {key: "status", label: "状态"},
  ];

const fields: FormField[] = [
    {key: "key", label: "配置项", required: true},
    {key: "value", label: "值"},
    {key: "description", label: "说明"},
    {key: "status", label: "状态", type: "select", options: ["启用", "停用"]},
  ];

function Page_OrdersSettings() {
  return (
    <DataListPage
      title="订单设置"
      description="订单相关配置项（如自动审单开关、备注模板等）"
      table="order_settings"
      columns={columns}
      fields={fields}
      addLabel="新增配置"
    />
  );
}
