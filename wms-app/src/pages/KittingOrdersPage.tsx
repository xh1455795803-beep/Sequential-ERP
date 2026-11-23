import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { PackageCheck, ArrowRightLeft, Package, Boxes, Sparkles, Lightbulb, ArrowRight } from 'lucide-react';

// -------- 组套管理（已降级为提示页面） --------
// 不再独立维护组套单，组装逻辑统一在"出库管理 → 发货单"打包时触发
// 此页面保留历史组套单的只读查看能力 + 引导入口
export function KittingOrdersPage() {
  const { data: kitting } = useQuery({
    queryKey: ['wms_kitting_orders_archive'],
    queryFn: async () => {
      const { data } = await supabase.from('wms_kitting_orders')
        .select('*, bom:bom_id(bom_no, sku, sku_name), warehouse:warehouse_id(name, code)')
        .order('created_at', { ascending: false })
        .limit(20);
      return data || [];
    },
  });

  const statusLabel: any = {
    draft: '草稿', released: '已释放', picking: '拣货中',
    kitting: '组套中', completed: '已完成', cancelled: '已取消',
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <PackageCheck className="w-8 h-8 text-brand-500" />
        <div>
          <h2 className="text-2xl font-bold">组套生产</h2>
          <p className="text-sm text-gray-500 mt-1">已升级为"出库打包时一键组装"模式</p>
        </div>
      </div>

      {/* 🆕 升级提示卡 */}
      <div className="bg-gradient-to-br from-brand-50 via-amber-50 to-sea-50 rounded-xl border border-brand-200 p-6 mb-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 bg-brand-500 rounded-xl flex items-center justify-center shrink-0 shadow-lg">
            <Sparkles className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1">
            <div className="text-lg font-semibold text-brand-700 mb-1">组套功能已升级 🎉</div>
            <p className="text-sm text-gray-600 leading-relaxed mb-4">
              组套不再是独立的工单流程。现在你可以直接在<strong className="text-brand-600">出库管理 → 发货单打包</strong>时，
              系统会自动识别该发货 SKU 是否存在<strong className="text-brand-600">组装清单</strong>，
              然后一键完成"扣组件库存 → 加成品库存 → 打包入发货包裹"的全流程。
            </p>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <Feature icon={<Package className="w-4 h-4" />} title="精简流程" desc="跳过独立组套单创建" />
              <Feature icon={<Boxes className="w-4 h-4" />} title="自动扣组件" desc="打包时自动从库中扣组件" />
              <Feature icon={<ArrowRightLeft className="w-4 h-4" />} title="成品直接出库" desc="组装完即发货，无中间环节" />
            </div>
            <div className="flex gap-2">
              <a href="#/wms/shipments"
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-brand-500 text-white rounded-lg text-sm hover:bg-brand-600">
                去出库管理
                <ArrowRight className="w-4 h-4" />
              </a>
              <a href="#/wms/bom"
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-white border border-brand-300 text-brand-600 rounded-lg text-sm hover:bg-brand-50">
                查看组装清单
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* 历史组套单（只读） */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 font-medium flex items-center gap-1.5">
          <Lightbulb className="w-4 h-4 text-amber-500" /> 历史组套单（只读，最多显示最近 20 条）
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs">
            <tr>
              <th className="text-left px-5 py-2.5">组套单号</th>
              <th className="text-left px-5 py-2.5">成品 SKU</th>
              <th className="text-left px-5 py-2.5">仓库</th>
              <th className="text-right px-5 py-2.5">数量</th>
              <th className="text-left px-5 py-2.5">状态</th>
              <th className="text-left px-5 py-2.5">创建时间</th>
            </tr>
          </thead>
          <tbody>
            {(kitting || []).map((k: any) => (
              <tr key={k.id} className="border-t border-gray-50">
                <td className="px-5 py-3 font-mono text-brand-600">{k.order_no}</td>
                <td className="px-5 py-3">
                  <div className="font-mono text-xs">{k.output_sku || k.bom?.sku}</div>
                  <div className="text-xs text-gray-400">{k.bom?.sku_name}</div>
                </td>
                <td className="px-5 py-3">{k.warehouse?.name || '-'}</td>
                <td className="px-5 py-3 text-right font-medium">{k.output_qty}</td>
                <td className="px-5 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs ${kittingBadge(k.status)}`}>{statusLabel[k.status] || k.status}</span>
                </td>
                <td className="px-5 py-3 text-xs text-gray-400">
                  {new Date(k.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
            {!kitting?.length && <tr><td colSpan={6} className="p-10 text-center text-gray-400">暂无历史组套单</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Feature({ icon, title, desc }: any) {
  return (
    <div className="bg-white rounded-lg p-3 text-sm">
      <div className="text-brand-600 mb-1">{icon}</div>
      <div className="font-medium text-gray-800 text-xs">{title}</div>
      <div className="text-[11px] text-gray-500 mt-0.5">{desc}</div>
    </div>
  );
}

function kittingBadge(s: string) {
  const m: any = {
    draft: 'bg-gray-100 text-gray-500', released: 'bg-blue-50 text-blue-600',
    picking: 'bg-amber-50 text-amber-600', kitting: 'bg-purple-50 text-purple-600',
    completed: 'bg-green-50 text-green-600', cancelled: 'bg-gray-100 text-gray-400',
  };
  return m[s] || 'bg-gray-100';
}

// 占位详情页（保持 main.tsx 路由引用不崩）
export function KittingDetailPage() {
  return (
    <div className="p-8 text-center text-gray-400">
      组套单详情页已降级，功能已迁移至出库打包流程
    </div>
  );
}
