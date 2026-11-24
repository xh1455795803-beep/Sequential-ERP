import { useEffect, useState } from 'react';
import { supabase, getAuthContext } from '../../lib/supabase';
import { GitBranch, GripVertical, Save, Plus, Trash2, Play, Zap } from 'lucide-react';

export function WmsFlowConfigPage() {
  const [loading, setLoading] = useState(true);
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [flows, setFlows] = useState<any[]>([]);
  const [activeType, setActiveType] = useState<'packing' | 'stocking'>('packing');

  useEffect(() => {
    (async () => {
      const ctx = await getAuthContext();
      if (!ctx.warehouseId) { setLoading(false); return; }
      setWarehouseId(ctx.warehouseId);
      await loadFlows(ctx.warehouseId);
    })();
  }, []);

  async function loadFlows(wid: string) {
    const { data } = await supabase.from('tlv_warehouse_flows')
      .select('*, nodes:tlv_flow_nodes(*)')
      .eq('warehouse_id', wid).order('flow_type');
    setFlows(data || []);
    setLoading(false);
  }

  const activeFlow = flows.find(f => f.flow_type === activeType);
  const activeNodes = activeFlow?.nodes?.sort((a: any, b: any) => a.sequence - b.sequence) || [];

  const NODE_PRESETS = {
    packing: [
      { code: 'pick', name: '拣货', desc: '按单找货，扫码确认' },
      { code: 'pack', name: '打包', desc: '包裹封装，贴面单' },
      { code: 'qc', name: '质检', desc: '抽检商品外观/规格' },
      { code: 'weigh', name: '称重', desc: '计费重量确认' },
      { code: 'verify', name: '核验', desc: '扫码核对订单-包裹' },
      { code: 'ship', name: '出库', desc: '交物流商' },
    ],
    stocking: [
      { code: 'receive', name: '签收', desc: '核对包裹数量/外箱完好' },
      { code: 'split', name: '拆包', desc: '外箱拆解，分拣 SKU' },
      { code: 'qc', name: '质检', desc: '抽检商品外观/规格' },
      { code: 'shelve', name: '上架', desc: '库位扫码确认' },
    ],
  };

  async function addNode() {
    if (!activeFlow || !warehouseId) return;
    const preset = NODE_PRESETS[activeType];
    const used = new Set(activeNodes.map((n: any) => n.node_code));
    const avail = preset.find(p => !used.has(p.code));
    if (!avail) return;

    const newSeq = (activeNodes[activeNodes.length - 1]?.sequence || 0) + 1;
    await supabase.from('tlv_flow_nodes').insert({
      flow_id: activeFlow.id,
      node_code: avail.code,
      node_name: avail.name,
      sequence: newSeq,
      required: avail.code !== 'qc',
    });
    await loadFlows(warehouseId);
  }

  async function removeNode(nodeId: string) {
    if (!warehouseId) return;
    await supabase.from('tlv_flow_nodes').delete().eq('id', nodeId);
    await loadFlows(warehouseId);
  }

  async function toggleRequired(node: any) {
    if (!warehouseId) return;
    await supabase.from('tlv_flow_nodes').update({ required: !node.required }).eq('id', node.id);
    await loadFlows(warehouseId);
  }

  async function moveNode(nodeId: string, dir: -1 | 1) {
    if (!activeFlow || !warehouseId) return;
    const nodes = [...activeNodes];
    const idx = nodes.findIndex(n => n.id === nodeId);
    const swapIdx = idx + dir;
    if (idx < 0 || swapIdx < 0 || swapIdx >= nodes.length) return;
    const tmp = nodes[idx].sequence;
    nodes[idx].sequence = nodes[swapIdx].sequence;
    nodes[swapIdx].sequence = tmp;
    await Promise.all([
      supabase.from('tlv_flow_nodes').update({ sequence: nodes[idx].sequence }).eq('id', nodes[idx].id),
      supabase.from('tlv_flow_nodes').update({ sequence: nodes[swapIdx].sequence }).eq('id', nodes[swapIdx].id),
    ]);
    await loadFlows(warehouseId);
  }

  async function saveMode(mode: 'standard' | 'quick') {
    if (!activeFlow || !warehouseId) return;
    await supabase.from('tlv_warehouse_flows').update({ mode }).eq('id', activeFlow.id);
    await loadFlows(warehouseId);
  }

  const nodeColors: Record<string, { bg: string; border: string; icon: string }> = {
    receive: { bg: 'bg-slate-50', border: 'border-slate-200', icon: '📦' },
    split: { bg: 'bg-amber-50', border: 'border-amber-200', icon: '🔪' },
    qc: { bg: 'bg-red-50', border: 'border-red-200', icon: '🔍' },
    shelve: { bg: 'bg-blue-50', border: 'border-blue-200', icon: '📚' },
    pick: { bg: 'bg-indigo-50', border: 'border-indigo-200', icon: '🎯' },
    pack: { bg: 'bg-purple-50', border: 'border-purple-200', icon: '📦' },
    weigh: { bg: 'bg-cyan-50', border: 'border-cyan-200', icon: '⚖️' },
    verify: { bg: 'bg-emerald-50', border: 'border-emerald-200', icon: '✅' },
    ship: { bg: 'bg-green-50', border: 'border-green-200', icon: '🚚' },
  };

  if (loading) return <div className="p-12 text-center text-slate-400">加载中...</div>;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
        <div className="flex items-center gap-3 justify-between">
          <div className="flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-purple-600" />
            <h3 className="font-semibold text-slate-700">仓库流程配置</h3>
            <span className="text-xs text-slate-400">打包流程 / 备库流程，节点可视化配置</span>
          </div>
        </div>

        {/* Tab 切换 */}
        <div className="mt-4 flex gap-4 border-b border-slate-200">
          {(['packing', 'stocking'] as const).map(t => (
            <button key={t} onClick={() => setActiveType(t)}
              className={`pb-2 text-sm font-medium border-b-2 transition ${
                activeType === t ? 'border-purple-600 text-purple-700' : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}>
              {t === 'packing' ? '📦 打包出库流程' : '🛒 备库入库流程'}
            </button>
          ))}
        </div>

        {/* 模式切换 */}
        {activeFlow && (
          <div className="mt-4 flex items-center gap-3">
            <span className="text-xs text-slate-500">当前模式:</span>
            <button onClick={() => saveMode('standard')}
              className={`px-3 py-1 text-xs rounded-full flex items-center gap-1 ${activeFlow.mode === 'standard' ? 'bg-purple-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
              <Play className="w-3 h-3" /> 标准模式（全流程节点）
            </button>
            <button onClick={() => saveMode('quick')}
              className={`px-3 py-1 text-xs rounded-full flex items-center gap-1 ${activeFlow.mode === 'quick' ? 'bg-purple-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
              <Zap className="w-3 h-3" /> 快捷模式（跳过非必要节点）
            </button>
            <button onClick={addNode}
              className="ml-auto px-3 py-1 text-xs bg-purple-600 hover:bg-purple-700 text-white rounded-lg flex items-center gap-1">
              <Plus className="w-3 h-3" /> 添加节点
            </button>
          </div>
        )}
      </div>

      {/* 节点流 */}
      {activeFlow && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6">
          <div className="flex flex-wrap items-center gap-2">
            {activeNodes.map((node, idx) => {
              const colors = nodeColors[node.node_code] || { bg: 'bg-slate-50', border: 'border-slate-200', icon: '◆' };
              return (
                <div key={node.id} className="flex items-center gap-2">
                  <div className={`relative group border-2 ${colors.border} ${colors.bg} rounded-xl p-3 w-40 cursor-pointer transition hover:shadow-md`}
                    title={NODE_PRESETS[activeType].find(p => p.code === node.node_code)?.desc}>
                    <div className="absolute -top-2 -left-2 w-5 h-5 bg-purple-600 text-white text-[10px] rounded-full flex items-center justify-center font-bold">
                      {idx + 1}
                    </div>
                    <div className="text-2xl text-center mb-1">{colors.icon}</div>
                    <div className="text-center font-semibold text-sm text-slate-800">{node.node_name}</div>
                    <div className="text-center text-[10px] text-slate-500 mt-0.5">{node.node_code}</div>
                    <div className={`text-center text-[10px] mt-1 ${node.required ? 'text-red-600' : 'text-slate-400'}`}>
                      {node.required ? '● 必填' : '○ 可选'}
                    </div>

                    {/* 悬停操作 */}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 rounded-xl flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition">
                      <button onClick={() => moveNode(node.id, -1)}
                        className="w-6 h-6 bg-white rounded shadow text-xs">↑</button>
                      <button onClick={() => moveNode(node.id, 1)}
                        className="w-6 h-6 bg-white rounded shadow text-xs">↓</button>
                      <button onClick={() => toggleRequired(node)}
                        className="w-6 h-6 bg-white rounded shadow text-[10px]" title="切换必填">
                        {node.required ? '✓' : '○'}
                      </button>
                      <button onClick={() => removeNode(node.id)}
                        className="w-6 h-6 bg-red-500 text-white rounded shadow">×</button>
                    </div>
                  </div>
                  {idx < activeNodes.length - 1 && (
                    <div className="text-purple-300 text-xl">→</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 说明 */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-800">
        💡 <b>提示:</b> 鼠标悬停节点可调整顺序、切换必填属性或删除。快捷模式下系统会自动跳过标记为「可选」的节点，减少操作步骤。
      </div>
    </div>
  );
}
