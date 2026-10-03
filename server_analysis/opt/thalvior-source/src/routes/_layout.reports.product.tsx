import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/reports/product")({
  component: ProductReport,
});

const columns = [
  { key: "name", label: "商品" },
  { key: "sku", label: "SKU" },
  { key: "category", label: "分类" },
  { key: "price", label: "价格" },
  { key: "status", label: "状态" },
];

const fields: FormField[] = [
  { key: "name", label: "商品名称", required: true, placeholder: "如：无线蓝牙耳机 Pro" },
  { key: "sku", label: "SKU", required: true, placeholder: "如：BT-001-BK" },
  { key: "category", label: "分类", placeholder: "如：3C 数码" },
  { key: "price", label: "价格", type: "number", placeholder: "如：39.9" },
  { key: "status", label: "状态", type: "select", options: ["在售", "下架", "草稿"] },
];

function ProductReport() {
  return (
    <DataListPage
      title="商品分析"
      description="商品表现深度分析，洞察销售趋势"
      table="products"
      columns={columns}
      fields={fields}
      addLabel="新增商品"
      exportable
    />
  );
}