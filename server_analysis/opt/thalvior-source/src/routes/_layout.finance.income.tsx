import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/finance/income")({
  component: FinanceIncomePage,
});

const columns: ListColumn[] = [
  { key: "date", label: "日期" },
  { key: "platform", label: "平台" },
  { key: "shop", label: "店铺" },
  { key: "order_no", label: "订单号" },
  { key: "amount", label: "金额" },
  { key: "currency", label: "币种" },
  { key: "type", label: "类型" },
  { key: "status", label: "状态" }
];

const fields: FormField[] = [
  { key: "date", label: "日期" },
  { key: "platform", label: "平台" },
  { key: "shop", label: "店铺" },
  { key: "order_no", label: "订单号" },
  { key: "amount", label: "金额", type: "number", required: true },
  { key: "currency", label: "币种", type: "select", options: ["CNY", "USD", "EUR", "GBP", "JPY"] },
  { key: "type", label: "类型", type: "select", options: ["销售收入", "退款冲减", "其他收入"] },
  { key: "status", label: "状态", type: "select", options: ["已确认", "待确认"] },
  { key: "note", label: "备注" }
];

function FinanceIncomePage() {
  return (
    <DataListPage
      addLabel="common.add"
      title="收入管理"
      description="各平台销售收入与其他收入登记"
      table="income_records"
      columns={columns}
      fields={fields}
    />
  );
}
