import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/purchase/suppliers")({
  component: Page_PurchaseSuppliers,
});

const columns: ListColumn[] = [
    {key: "name", label: "名称"},
    {key: "contact", label: "联系人"},
    {key: "phone", label: "电话"},
    {key: "status", label: "状态"},
  ];

const fields: FormField[] = [
    {key: "name", label: "名称", required: true},
    {key: "contact", label: "联系人"},
    {key: "phone", label: "电话"},
    {key: "status", label: "状态", type: "select", options: ["启用", "停用"]},
  ];

function Page_PurchaseSuppliers() {
  return (
    <DataListPage
      addLabel="common.add"
      title="供应商管理"
      description="管理供应商（启用/停用）"
      table="suppliers"
      columns={columns}
      fields={fields}
      exportable
      batchDelete
    />
  );
}
