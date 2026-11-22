import { cn } from "@/lib/utils";
import { useLanguage } from "@/i18n/LanguageContext";

// 状态徽章配色（覆盖订单/授权/采购/物流/财务等全模块）
const statusStyles: Record<string, string> = {
  待审核: "bg-warning-bg text-warning",
  待发货: "bg-warning-bg text-warning",
  已发货: "bg-info-bg text-info",   /* 进行中=蓝，待办=橙 */
  已完成: "bg-success-bg text-success",
  售后中: "bg-danger-bg text-destructive",
  // 授权
  已授权: "bg-success-bg text-success",
  待验证: "bg-warning-bg text-warning",
  即将到期: "bg-warning-bg text-warning",
  已过期: "bg-danger-bg text-destructive",
  已停用: "bg-muted text-muted-foreground",
  未授权: "bg-danger-bg text-destructive",
  正常: "bg-success-bg text-success",
  // 采集
  待处理: "bg-warning-bg text-warning",
  已上架: "bg-success-bg text-success",
  待采集: "bg-warning-bg text-warning",
  // 采购/供应商
  合作中: "bg-success-bg text-success",
  待评估: "bg-warning-bg text-warning",
  待采购: "bg-warning-bg text-warning",
  采购中: "bg-warning-bg text-warning",
  已下单: "bg-warning-bg text-warning",
  已入库: "bg-success-bg text-success",
  已取消: "bg-muted text-muted-foreground",
  待备货: "bg-warning-bg text-warning",
  待出库: "bg-warning-bg text-warning",
  待入库: "bg-warning-bg text-warning",
  售罄: "bg-danger-bg text-destructive",
  审核中: "bg-warning-bg text-warning",
  异常: "bg-danger-bg text-destructive",
  失败: "bg-danger-bg text-destructive",
  退款中: "bg-danger-bg text-destructive",
  // 物流轨迹（tracking_status 英文 code，四色体系）
  created: "bg-muted/50 text-muted-foreground",
  notfound: "bg-muted/50 text-muted-foreground",
  in_transit: "bg-info-bg text-info",
  delivered: "bg-success-bg text-success",
  exception: "bg-danger-bg text-destructive",
  expired: "bg-muted text-muted-foreground",
  pending_register: "bg-warning-bg text-warning",
  // 物流（英文 code：logistics_channels.status / shipments.status 旧数据）
  active: "bg-success-bg text-success",
  inactive: "bg-muted text-muted-foreground",
  shipped: "bg-info-bg text-info",
  cancelled: "bg-muted text-muted-foreground",
  // 物流
  启用: "bg-success-bg text-success",
  停用: "bg-muted text-muted-foreground",
  运输中: "bg-info-bg text-info",   /* 进行中=蓝 */
  已签收: "bg-success-bg text-success",
  // 通用
  已暂停: "bg-muted text-muted-foreground",
  监控中: "bg-info-bg text-info",
  // 财务
  已结算: "bg-success-bg text-success",
  待结算: "bg-warning-bg text-warning",
  已入账: "bg-success-bg text-success",
  待支付: "bg-warning-bg text-warning",
  待核销: "bg-warning-bg text-warning",
  已核销: "bg-success-bg text-success",
  // vV1-T4：订单状态带用到的补齐值（原走 fallback 灰）
  待付款: "bg-warning-bg text-warning",
  部分发货: "bg-info-bg text-info",
  已退款: "bg-muted text-muted-foreground",
  已删除: "bg-muted text-muted-foreground",
};

export function StatusBadge({ status }: { status: string }) {
  const { t } = useLanguage();
  const key = `status.${status}`;
  const label = t(key);
  // 字典没配到这个值时，translate 会原样返回 key；徽章不能把 "status.xxx" 甩给用户看
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center whitespace-nowrap rounded-[3px] px-2 text-xs font-medium leading-4",
        statusStyles[status] ?? "bg-muted/50 text-muted-foreground"
      )}
    >
      {label === key ? status || "—" : label}
    </span>
  );
}

export function ProductStatusBadge({ status }: { status: string }) {
  const { t } = useLanguage();
  const map: Record<string, string> = {
    在售: "bg-success-bg text-success",
    下架: "bg-muted text-muted-foreground",
    草稿: "bg-muted text-muted-foreground",
    售罄: "bg-danger-bg text-destructive",
  };
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center whitespace-nowrap rounded-[3px] px-2 text-xs font-medium leading-4",
        map[status] ?? "bg-muted/50 text-muted-foreground"
      )}
    >
      {t(`status.${status}`)}
    </span>
  );
}