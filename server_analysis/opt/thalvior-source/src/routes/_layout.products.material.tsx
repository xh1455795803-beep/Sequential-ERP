import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/products/material")({
  component: Material,
});

const columns = [
  { key: "name", label: "素材名称" },
  { key: "type", label: "类型" },
  { key: "size", label: "大小" },
  { key: "created_at", label: "上传时间" },
];

const fields: FormField[] = [
  { key: "name", label: "素材名称", required: true, placeholder: "如：蓝牙耳机主图.png" },
  { key: "type", label: "类型", type: "select", options: ["图片", "视频", "文档"] },
  { key: "size", label: "大小", placeholder: "如：2.4 MB" },
  { key: "created_at", label: "上传时间", placeholder: "如：2026-09-22" },
];

function Material() {
  return (
    <DataListPage
      title="素材库"
      description="统一管理商品图片、视频等素材资源"
      table="materials"
      columns={columns}
      fields={fields}
      addLabel="上传素材"
    />
  );
}