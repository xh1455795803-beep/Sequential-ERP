import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/products/material")({
  component: Material,
});

const columns = [
  { key: "name", label: "pm.mat.name" },
  { key: "type", label: "pm.col.type" },
  { key: "size", label: "pm.col.size" },
  { key: "created_at", label: "pm.mat.createdAt" },
];

const fields: FormField[] = [
  { key: "name", label: "pm.mat.name", required: true, placeholder: "pm.mat.namePh" },
  { key: "type", label: "pm.col.type", type: "select", options: [{ label: "ai.res.image", value: "图片" }, { label: "ai.res.video", value: "视频" }, { label: "ai.res.doc", value: "文档" }] },
  { key: "size", label: "pm.col.size", placeholder: "pm.mat.sizePh" },
  { key: "created_at", label: "pm.mat.createdAt", placeholder: "pm.mat.createdAtPh" },
];

function Material() {
  return (
    <DataListPage
      title="nav.products.material"
      description="pm.mat.desc"
      table="materials"
      columns={columns}
      fields={fields}
      addLabel="pm.mat.add"
    />
  );
}