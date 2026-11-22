import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

import { tt } from "@/i18n/tts";
export const Route = createFileRoute("/_layout/exceptions/logistics")({
  component: ExceptionsLogistics,
});

const columns: ListColumn[] = [
  { key: "level", label: "exc.level" },
  { key: "title", label: "common.title" },
  { key: "source", label: "orders.sync.col.source" },
  { key: "status", label: "common.statusLabel" },
  { key: "created_at", label: "orders.sync.col.time" },
];

const fields: FormField[] = [
  { key: "title", label: "common.title", required: true, placeholder: "exc.titlePh" },
  { key: "type", label: "common.type", type: "select", options: [{ label: "label.order", value: "订单" },{ label: "products.col.stock", value: "库存" },{ label: "exc.catPurchase", value: "采购" },{ label: "exc.catLogistics", value: "物流" },{ label: "exc.catAftersale", value: "售后" },{ label: "exc.catFinance", value: "财务" },{ label: "exc.catSync", value: "平台同步" },"Webhook",{ label: "exc.catFulfillment", value: "履约" }] },
  { key: "level", label: "exc.level", type: "select", options: [{ label: "exc.sevCritical", value: "严重" },{ label: "exc.sevWarning", value: "警告" },{ label: "exc.tip", value: "提示" }] },
  { key: "source", label: "orders.sync.col.source", placeholder: "exc.sourcePh" },
  { key: "related_id", label: "exc.relatedNo", placeholder: "exc.relatedNoPh" },
  { key: "message", label: "common.detail", placeholder: "exc.descLabel" },
  { key: "status", label: "common.statusLabel", type: "select", options: [{ label: "st.pending", value: "待处理" },{ label: "st.processing", value: "处理中" },{ label: "st.resolved", value: "已解决" },{ label: "st.ignored", value: "已忽略" }] },
  { key: "resolved_note", label: "exc.handlingNote", placeholder: "exc.conclusion" },
];

function ExceptionsLogistics() {
  return (
    <DataListPage
      title="nav.exceptions.logistics"
      description="exc.logisticsDesc"
      table="exceptions"
      columns={columns}
      fields={fields}
      filter={{ field: "type", value: "物流" }}
      addLabel="exc.reportBtn"
      exportable
      batchDelete
    />
  );
}
