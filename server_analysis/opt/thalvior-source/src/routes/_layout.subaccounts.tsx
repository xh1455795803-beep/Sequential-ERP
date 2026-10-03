import { createFileRoute } from "@tanstack/react-router";
import { DataListPage, type FormField } from "@/components/data-list-page";

export const Route = createFileRoute("/_layout/subaccounts")({
  component: SubAccounts,
});

const columns = [
  { key: "name", label: "子账号名称" },
  { key: "email", label: "邮箱" },
  { key: "role", label: "角色" },
  { key: "status", label: "状态" },
];

const fields: FormField[] = [
  { key: "name", label: "子账号名称", required: true, placeholder: "如：运营小王" },
  { key: "email", label: "邮箱", placeholder: "如：xiaowang@example.com" },
  { key: "role", label: "角色", type: "select", options: ["运营", "客服", "财务", "管理员"] },
  { key: "status", label: "状态", type: "select", options: ["启用", "停用"] },
];

function SubAccounts() {
  return (
    <DataListPage
      title="子账号权限"
      description="为团队成员创建子账号，分配不同角色权限"
      table="sub_accounts"
      columns={columns}
      fields={fields}
      addLabel="新增子账号"
      exportable
      batchDelete
      stats={[
        { label: "启用", countBy: { field: "status", value: "启用" }, tone: "success" },
        { label: "停用", countBy: { field: "status", value: "停用" }, tone: "warning" },
      ]}
    />
  );
}