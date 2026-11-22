import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField } from "@/components/data-list-page";

import { tt } from "@/i18n/tts";
export const Route = createFileRoute("/_layout/tools/competitor")({
  component: CompetitorTool,
});

const columns = [
  { key: "name", label: "tools.comp.name" },
  { key: "platform", label: "collect.platformCol" },
  { key: "url", label: "tools.comp.link" },
  { key: "price", label: "products.col.price" },
  { key: "sales", label: "products.col.sales" },
  { key: "status", label: "common.statusLabel" },
];

const fields: FormField[] = [
  { key: "name", label: "tools.comp.name", required: true, placeholder: "tools.comp.namePh" },
  { key: "platform", label: "collect.platformCol", type: "select", options: ["Amazon", "eBay", "TikTok Shop", "Shopify", "Walmart", "Etsy"] },
  { key: "url", label: "tools.comp.productLink", placeholder: "https://..." },
  { key: "price", label: "products.col.price", type: "number" },
  { key: "sales", label: "products.col.sales", type: "number" },
  { key: "status", label: "common.statusLabel", type: "select", options: [{ label: "st.monitoring", value: "监控中" }, { label: "st.delisted", value: "已下架" }, { label: "tools.comp.surpassed", value: "已超越" }] },
];

function CompetitorTool() {
  return (
    <DataListPage
      title="nav.tools.competitor"
      description="tools.comp.desc"
      table="competitor_tracks"
      columns={columns}
      fields={fields}
      addLabel="tools.comp.add"
      exportable
      batchDelete
    />
  );
}