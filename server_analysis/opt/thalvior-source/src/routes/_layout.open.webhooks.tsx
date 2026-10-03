import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/open/webhooks")({
  component: OpenWebhooks,
});

const columns: ListColumn[] = [
  { key: "url", label: "地址" },
  { key: "event", label: "事件" },
  { key: "status", label: "状态" },
  { key: "last_triggered_at", label: "最近触发" },
  { key: "created_at", label: "创建时间" },
];

const fields: FormField[] = [
  { key: "url", label: "地址", required: true, placeholder: "https://hook.example.com" },
  { key: "event", label: "事件", type: "select", options: ["order.created","order.paid","order.shipped","inventory.low","exception.raised"] },
  { key: "secret", label: "签名密钥", placeholder: "用于校验回调签名" },
  { key: "status", label: "状态", type: "select", options: ["启用","停用"] },
];

function OpenWebhooks() {
  return (
    <DataListPage
      title="Webhook"
      description="管理事件回调订阅"
      table="webhooks"
      columns={columns}
      fields={fields}
      addLabel="新建Webhook"
      exportable
      batchDelete
    />
  );
}
