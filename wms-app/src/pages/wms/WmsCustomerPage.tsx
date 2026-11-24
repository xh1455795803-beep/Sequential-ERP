import { useEffect, useState } from 'react';
import { supabase, getAuthContext } from '../../lib/supabase';
import { Users, Plus, Phone, Mail, MessageSquare, Calendar, TrendingUp, Wallet, Package, AlertCircle } from 'lucide-react';

export function WmsCustomerPage() {
  const [loading, setLoading] = useState(true);
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [merchants, setMerchants] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [followups, setFollowups] = useState<any[]>([]);
  const [showNewFollowup, setShowNewFollowup] = useState(false);

  useEffect(() => {
    (async () => {
      const ctx = await getAuthContext();
      if (!ctx.warehouseId) { setLoading(false); return; }
      setWarehouseId(ctx.warehouseId);
      await Promise.all([
        loadMerchants(ctx.warehouseId),
        loadProfiles(ctx.warehouseId),
      ]);
      setLoading(false);
    })();
  }, []);

  async function loadMerchants(wid: string) {
    const { data } = await supabase.from('tlv_merchants')
      .select('*').eq('warehouse_id', wid).order('business_name');
    setMerchants(data || []);
    if (data?.length && !selected) setSelected(data[0].id);
  }

  async function loadProfiles(wid: string) {
    // 用 REST API 直接查询 view（RLS 需要 warehouse_id 过滤）
    const url = `${(supabase as any).url}/rest/v1/tlv_customer_profiles?warehouse_id=eq.${wid}&select=*`;
    const req = new Request(url, {
      headers: {
        'apikey': (supabase as any).anonKey,
        'Authorization': `Bearer ${(supabase as any).anonKey}`,
        'Prefer': 'return=representation',
      },
    });
    try {
      const resp = await fetch(req);
      const data = await resp.json();
      setProfiles(Array.isArray(data) ? data : []);
    } catch { /* view 权限问题时 fallback */ }
  }

  async function loadFollowups(mid: string) {
    const { data } = await supabase.from('tlv_customer_followups')
      .select('*').eq('merchant_id', mid).order('created_at', { ascending: false });
    setFollowups(data || []);
  }

  async function addSample(wid: string) {
    const merchants = await supabase.from('tlv_merchants').select('id').eq('warehouse_id', wid);
    const mids = (merchants.data || []).map((m: any) => m.id);
    if (!mids.length) return;
    const samples = [
      { warehouse_id: wid, merchant_id: mids[0], followup_type: 'phone',
        content: '客户反馈 1688 采购流程想对接 API，建议安排技术对接会',
        sentiment: 'urgent', next_followup_at: new Date(Date.now() + 24*3600_000).toISOString(),
        followup_name: 'wms@thalvior.dev' },
      { warehouse_id: wid, merchant_id: mids[0], followup_type: 'wechat',
        content: '客户表示下月订单量预计上涨 30%，需提前备货',
        sentiment: 'positive', followup_name: 'wms@thalvior.dev' },
    ];
    await supabase.from('tlv_customer_followups').insert(samples);
    if (selected) await loadFollowups(selected);
  }

  async function deleteFollowup(id: string) {
    if (!selected) return;
    await supabase.from('tlv_customer_followups').delete().eq('id', id);
    await loadFollowups(selected);
  }

  useEffect(() => {
    if (selected && warehouseId) loadFollowups(selected);
  }, [selected]);

  const profileMap = Object.fromEntries(profiles.map(p => [p.merchant_id, p]));
  const selectedMerchant = merchants.find(m => m.id === selected);
  const selectedProfile = selected ? profileMap[selected] : null;

  const sentimentColors: Record<string, string> = {
    positive: 'bg-green-50 text-green-700', neutral: 'bg-slate-50 text-slate-600',
    negative: 'bg-red-50 text-red-700', urgent: 'bg-amber-50 text-amber-700',
  };
  const followupCn: Record<string, string> = {
    phone: '📞 电话', wechat: '💬 微信', email: '✉️ 邮件', visit: '🏢 拜访', note: '📝 笔记', reminder: '⏰ 提醒',
  };

  if (loading) return <div className="p-12 text-center text-slate-400">加载中...</div>;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
        <div className="flex items-center gap-3 justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-indigo-600" />
            <h3 className="font-semibold text-slate-700">客户管理</h3>
            <span className="text-xs text-slate-400">客户画像 · 跟进盘活 · 跟进记录</span>
          </div>
          <button onClick={() => warehouseId && addSample(warehouseId)}
            className="px-3 py-1 text-xs bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-600">
            + 生成示例跟进
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 左: 商家列表 */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 text-xs font-semibold text-slate-600">
            客户列表 ({merchants.length})
          </div>
          <div className="divide-y divide-slate-50 max-h-[500px] overflow-y-auto">
            {merchants.map(m => {
              const p = profileMap[m.id];
              return (
                <button key={m.id} onClick={() => setSelected(m.id)}
                  className={`w-full text-left px-4 py-2.5 transition ${selected === m.id ? 'bg-indigo-50 border-l-4 border-indigo-500' : 'hover:bg-slate-50 border-l-4 border-transparent'}`}>
                  <div className="text-sm font-medium text-slate-800 truncate">{m.business_name}</div>
                  <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
                    <span className="font-mono">{m.id.slice(0,8)}</span>
                    {p && p.orders_30d > 0 && <span className="text-indigo-600">📈 {p.orders_30d} 单/30天</span>}
                    {p && p.issue_open > 0 && <span className="text-red-600">⚠ {p.issue_open}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 右: 详情 */}
        <div className="lg:col-span-2 space-y-4">
          {!selectedMerchant ? (
            <div className="bg-white rounded-xl border border-slate-100 p-12 text-center text-slate-400 text-sm">
              选择左侧客户查看详情
            </div>
          ) : (
            <>
              {/* 画像卡片 */}
              <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h4 className="font-semibold text-slate-800 text-lg">{selectedMerchant.business_name}</h4>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {selectedMerchant.contact_name} · {selectedMerchant.contact_email} · {selectedMerchant.contact_phone}
                    </div>
                  </div>
                  {selectedProfile?.issue_open > 0 && (
                    <span className="px-2 py-1 bg-red-50 text-red-700 text-xs rounded flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> {selectedProfile.issue_open} 待处理问题
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-4 gap-3">
                  <StatCard icon={<TrendingUp className="w-4 h-4" />} label="30 天订单" value={selectedProfile?.orders_30d || 0} color="indigo" />
                  <StatCard icon={<Package className="w-4 h-4" />} label="活跃 SKU" value={selectedProfile?.sku_active || 0} color="blue" />
                  <StatCard icon={<Wallet className="w-4 h-4" />} label="钱包余额" value={`¥${(selectedProfile?.wallet_balance || 0).toFixed(2)}`} color="emerald" />
                  <StatCard icon={<Users className="w-4 h-4" />} label="跟进次数" value={selectedProfile?.followup_count || 0} color="purple" />
                </div>
              </div>

              {/* 跟进记录 */}
              <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h5 className="font-semibold text-slate-700 text-sm">跟进记录</h5>
                  <button onClick={() => setShowNewFollowup(true)}
                    className="px-3 py-1 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg flex items-center gap-1">
                    <Plus className="w-3 h-3" /> 添加跟进
                  </button>
                </div>

                {followups.length === 0 ? (
                  <div className="text-center text-slate-400 text-sm py-8">暂无跟进记录</div>
                ) : (
                  <div className="space-y-2">
                    {followups.map(f => (
                      <div key={f.id} className="flex gap-3 p-3 border border-slate-100 rounded-lg hover:bg-slate-50">
                        <div className="text-xl">{followupCn[f.followup_type] || '📝'}</div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-slate-700">{f.content}</div>
                          <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-400">
                            <span className={`px-1.5 py-0.5 rounded ${sentimentColors[f.sentiment]}`}>
                              {f.sentiment === 'positive' ? '😊 积极' : f.sentiment === 'negative' ? '😟 负面' : f.sentiment === 'urgent' ? '⚠ 紧急' : '😐 中立'}
                            </span>
                            <span>· {new Date(f.created_at).toLocaleString('zh-CN', { hour12: false })}</span>
                            {f.followup_name && <span>· {f.followup_name}</span>}
                            {f.next_followup_at && (
                              <span className="text-amber-600">⏰ 下次: {new Date(f.next_followup_at).toLocaleDateString('zh-CN')}</span>
                            )}
                          </div>
                        </div>
                        <button onClick={() => deleteFollowup(f.id)}
                          className="text-slate-300 hover:text-red-500 text-xs">删除</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {showNewFollowup && selectedMerchant && (
        <NewFollowupModal
          warehouseId={warehouseId!}
          merchantId={selectedMerchant.id}
          merchantName={selectedMerchant.business_name}
          onClose={() => setShowNewFollowup(false)}
          onDone={() => loadFollowups(selectedMerchant.id)}
        />
      )}
    </div>
  );
}

function StatCard({ icon, label, value, color }: any) {
  const colors: Record<string, string> = {
    indigo: 'from-indigo-50 to-indigo-100 text-indigo-700',
    blue: 'from-blue-50 to-blue-100 text-blue-700',
    emerald: 'from-emerald-50 to-emerald-100 text-emerald-700',
    purple: 'from-purple-50 to-purple-100 text-purple-700',
  };
  return (
    <div className={`p-3 rounded-lg bg-gradient-to-br ${colors[color]}`}>
      <div className="flex items-center gap-1 text-[11px] opacity-75">{icon} {label}</div>
      <div className="text-lg font-bold mt-1">{value}</div>
    </div>
  );
}

function NewFollowupModal({ warehouseId, merchantId, merchantName, onClose, onDone }: any) {
  const [form, setForm] = useState({
    followup_type: 'wechat', sentiment: 'neutral',
    content: '', next_followup_at: '',
  });
  async function submit() {
    await supabase.from('tlv_customer_followups').insert({
      warehouse_id: warehouseId, merchant_id: merchantId,
      followup_name: 'wms@thalvior.dev', ...form,
      next_followup_at: form.next_followup_at || null,
    });
    onDone(); onClose();
  }
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl p-6 w-96" onClick={e => e.stopPropagation()}>
        <h3 className="font-semibold text-slate-800 mb-1">添加跟进记录</h3>
        <p className="text-xs text-slate-400 mb-4">客户: {merchantName}</p>
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-slate-500">方式</label>
              <select value={form.followup_type} onChange={e => setForm({...form, followup_type: e.target.value})}
                className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg">
                <option value="phone">电话</option>
                <option value="wechat">微信</option>
                <option value="email">邮件</option>
                <option value="visit">拜访</option>
                <option value="note">笔记</option>
                <option value="reminder">提醒</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500">情绪</label>
              <select value={form.sentiment} onChange={e => setForm({...form, sentiment: e.target.value})}
                className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg">
                <option value="positive">😊 积极</option>
                <option value="neutral">😐 中立</option>
                <option value="negative">😟 负面</option>
                <option value="urgent">⚠ 紧急</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-500">跟进内容</label>
            <textarea value={form.content} onChange={e => setForm({...form, content: e.target.value})}
              rows={3} className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg" placeholder="记录沟通要点..." />
          </div>
          <div>
            <label className="text-xs text-slate-500">下次跟进时间（可选）</label>
            <input type="datetime-local" value={form.next_followup_at} onChange={e => setForm({...form, next_followup_at: e.target.value})}
              className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg" />
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 px-4 py-2 border border-slate-200 rounded-lg text-sm">取消</button>
          <button onClick={submit} className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm">保存</button>
        </div>
      </div>
    </div>
  );
}
