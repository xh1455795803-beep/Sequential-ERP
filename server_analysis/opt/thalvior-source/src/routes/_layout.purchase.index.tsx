import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/purchase/")({
  component: Purchase,
});

const columns = [
  { key: "name", label: "供应商" },
  { key: "contact", label: "联系人" },
  { key: "phone", label: "电话" },
  { key: "status", label: "合作状态" },
];

const fields: FormField[] = [
  { key: "name", label: "供应商名称", required: true, placeholder: "如：深圳华强电子" },
  { key: "contact", label: "联系人", placeholder: "如：王经理" },
  { key: "phone", label: "电话", placeholder: "如：13800000000" },
  { key: "status", label: "合作状态", type: "select", options: ["合作中", "待评估", "已终止"] },
];

function Purchase() {
  return (
    <DataListPage
      title="供应商管理"
      description="整合供应商资源，打通采购计划与入库退货全链路"
      table="suppliers"
      columns={columns}
      fields={fields}
      addLabel="新增供应商"
    />
  );
}
