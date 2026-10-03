import { cn } from "@/lib/utils";
import { useLanguage } from "@/i18n/LanguageContext";

// 状态徽章配色（覆盖订单/授权/采购/物流/广告/财务等全模块）
const statusStyles: Record<string, string> = {
  待审核: "bg-amber-50 text-amber-600 border-amber-200",
  待发货: "bg-blue-50 text-blue-600 border-blue-200",
  已发货: "bg-violet-50 text-violet-600 border-violet-200",
  已完成: "bg-emerald-50 text-emerald-600 border-emerald-200",
  售后中: "bg-rose-50 text-rose-600 border-rose-200",
  // 授权
  已授权: "bg-emerald-50 text-emerald-600 border-emerald-200",
  待验证: "bg-orange-50 text-orange-600 border-orange-200",
  即将到期: "bg-amber-50 text-amber-600 border-amber-200",
  已过期: "bg-rose-50 text-rose-600 border-rose-200",
  正常: "bg-emerald-50 text-emerald-600 border-emerald-200",
  // 采集
  待处理: "bg-amber-50 text-amber-600 border-amber-200",
  已上架: "bg-emerald-50 text-emerald-600 border-emerald-200",
  待采集: "bg-blue-50 text-blue-600 border-blue-200",
  // 采购/供应商
  合作中: "bg-emerald-50 text-emerald-600 border-emerald-200",
  待评估: "bg-amber-50 text-amber-600 border-amber-200",
  待采购: "bg-amber-50 text-amber-600 border-amber-200",
  采购中: "bg-blue-50 text-blue-600 border-blue-200",
  待备货: "bg-amber-50 text-amber-600 border-amber-200",
  待出库: "bg-blue-50 text-blue-600 border-blue-200",
  待入库: "bg-blue-50 text-blue-600 border-blue-200",
  // 物流
  启用: "bg-emerald-50 text-emerald-600 border-emerald-200",
  停用: "bg-slate-100 text-slate-500 border-slate-200",
  运输中: "bg-blue-50 text-blue-600 border-blue-200",
  已签收: "bg-emerald-50 text-emerald-600 border-emerald-200",
  // 广告
  投放中: "bg-emerald-50 text-emerald-600 border-emerald-200",
  已暂停: "bg-slate-100 text-slate-500 border-slate-200",
  监控中: "bg-blue-50 text-blue-600 border-blue-200",
  // 财务
  已结算: "bg-emerald-50 text-emerald-600 border-emerald-200",
  待结算: "bg-amber-50 text-amber-600 border-amber-200",
  已入账: "bg-emerald-50 text-emerald-600 border-emerald-200",
  待支付: "bg-amber-50 text-amber-600 border-amber-200",
  待核销: "bg-amber-50 text-amber-600 border-amber-200",
  已核销: "bg-emerald-50 text-emerald-600 border-emerald-200",
};

export function StatusBadge({ status }: { status: string }) {
  const { t } = useLanguage();
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        statusStyles[status] ?? "bg-slate-50 text-slate-600 border-slate-200"
      )}
    >
      {t(`status.${status}`)}
    </span>
  );
}

export function ProductStatusBadge({ status }: { status: string }) {
  const { t } = useLanguage();
  const map: Record<string, string> = {
    在售: "bg-emerald-50 text-emerald-600 border-emerald-200",
    下架: "bg-slate-100 text-slate-500 border-slate-200",
    草稿: "bg-amber-50 text-amber-600 border-amber-200",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        map[status] ?? "bg-slate-50 text-slate-600 border-slate-200"
      )}
    >
      {t(`status.${status}`)}
    </span>
  );
}