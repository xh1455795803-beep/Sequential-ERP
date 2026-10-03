import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/ads/accounts")({
  component: AdsAccountsPage,
});

const columns: ListColumn[] = [{ key: "name", label: "账户名称" }, { key: "platform", label: "平台" }, { key: "account_id", label: "账户 ID" }, { key: "currency", label: "币种" }, { key: "status", label: "状态" }, { key: "note", label: "备注" }];

const fields: FormField[] = [{ key: "name", label: "账户名称", required: true }, { key: "platform", label: "平台", type: "select", options: ["Amazon US", "Amazon JP", "TikTok Shop", "Temu", "Shopee", "Etsy"] }, { key: "account_id", label: "账户 ID" }, { key: "currency", label: "币种", type: "select", options: ["USD", "EUR", "GBP", "JPY", "CNY"] }, { key: "status", label: "状态", type: "select", options: ["启用", "停用"] }, { key: "note", label: "备注" }];

function AdsAccountsPage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="广告账户"
      description="各平台广告账户接入与状态管理"
      table="ad_accounts"
      columns={columns}
      fields={fields}
    />
  );
}
