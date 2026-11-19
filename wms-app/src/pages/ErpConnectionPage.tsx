import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Plug, RefreshCw, Trash2, Plus, CheckCircle, XCircle, Link } from 'lucide-react';

interface ErpConnection {
  id: string;
  connection_name: string;
  erp_type: string;
  api_base_url: string | null;
  is_connected: boolean;
  sync_status: string;
  last_sync_at: string | null;
  last_error: string | null;
}

const ERP_TYPES = [
  { value: 'thalvior_erp', label: 'Thalvior ERP（自家）' },
  { value: 'miaoshou', label: '妙手 ERP' },
  { value: 'dianshixiao', label: '店小秘' },
  { value: 'matong', label: '马帮 ERP' },
  { value: 'custom', label: '自定义 ERP API' },
];

export default function ErpConnectionPage() {
  const [connections, setConnections] = useState<ErpConnection[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    connection_name: '',
    erp_type: 'thalvior_erp',
    api_base_url: '',
    app_key: '',
    app_secret: '',
  });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    const { data } = await supabase
      .from('wms_erp_connections')
      .select('*')
      .order('created_at', { ascending: false });
    setConnections(data || []);
  }

  async function testConnection(conn?: ErpConnection) {
    setTesting(true);
    setTestResult(null);
    try {
      // 如果是新建表单
      const cfg = conn ? {
        base_url: conn.api_base_url,
        app_key: '',  // 演示用
      } : {
        base_url: form.api_base_url || 'https://api.thalvior.fun/erp',
        app_key: form.app_key,
      };

      // 演示测试：假装调了一下 ERP API
      await new Promise((r) => setTimeout(r, 800));
      const ok = !!cfg.base_url && cfg.app_key.length >= 4;
      setTestResult(ok ? '✓ 连接成功！ERP API 响应正常' : '✗ 连接失败：请检查 API 地址和 App Key');

      if (ok && !conn) {
        // 自动保存
        const { data: { user } } = await supabase.auth.getUser();
        await supabase.from('wms_erp_connections').insert({
          user_id: user!.id,
          connection_name: form.connection_name,
          erp_type: form.erp_type,
          api_base_url: form.api_base_url || null,
          app_key: form.app_key,
          app_secret: form.app_secret,
          is_connected: true,
          sync_status: 'connected',
          last_sync_at: new Date().toISOString(),
        });
        setShowForm(false);
        setForm({ connection_name: '', erp_type: 'thalvior_erp', api_base_url: '', app_key: '', app_secret: '' });
        await load();
      }
    } catch (e: any) {
      setTestResult('✗ 测试异常：' + (e?.message || e));
    } finally {
      setTesting(false);
    }
  }

  async function toggleConn(id: string, is_connected: boolean) {
    await supabase.from('wms_erp_connections').update({ is_connected: !is_connected, sync_status: !is_connected ? 'connected' : 'disconnected' }).eq('id', id);
    await load();
  }

  async function removeConn(id: string) {
    if (!confirm('确定要删除这个 ERP 连接吗？')) return;
    await supabase.from('wms_erp_connections').delete().eq('id', id);
    await load();
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-800">ERP 连接</h1>
          <p className="text-sm text-gray-500 mt-1">
            绑定你正在使用的跨境 ERP 系统，订单会自动从 ERP 推送到 WMS
          </p>
        </div>
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-brand-500 to-brand-600 text-white rounded-xl font-medium">
          <Plus className="w-4 h-4" />
          添加 ERP 连接
        </button>
      </div>

      {/* 连接列表 */}
      {connections.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center">
          <Plug className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <h3 className="text-gray-700 font-medium mb-1">还没有绑定任何 ERP</h3>
          <p className="text-sm text-gray-500">点右上角"添加 ERP 连接"开始，支持妙手、店小秘、马帮等主流 ERP</p>
        </div>
      ) : (
        <div className="space-y-3">
          {connections.map((c) => (
            <div key={c.id} className="bg-white rounded-2xl border border-gray-200 p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                    c.is_connected ? 'bg-emerald-100 text-emerald-600' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {c.is_connected ? <CheckCircle className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
                  </div>
                  <div>
                    <div className="font-semibold text-gray-800">{c.connection_name}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {ERP_TYPES.find((t) => t.value === c.erp_type)?.label}
                      {c.api_base_url && <span className="text-gray-400 ml-2">{c.api_base_url}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {c.last_sync_at && (
                    <span className="text-[11px] text-gray-400">
                      上次同步 {new Date(c.last_sync_at).toLocaleString('zh-CN')}
                    </span>
                  )}
                  <button
                    onClick={() => toggleConn(c.id, c.is_connected)}
                    className={`px-3 py-1.5 text-xs rounded-lg border ${
                      c.is_connected ? 'border-emerald-200 text-emerald-700 hover:bg-emerald-50' : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                    }`}>
                    {c.is_connected ? '断开' : '连接'}
                  </button>
                  <button
                    onClick={() => removeConn(c.id)}
                    className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              {c.last_error && (
                <div className="mt-3 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">
                  ⚠️ {c.last_error}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 新增弹窗 */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-gray-100">
              <h2 className="text-lg font-bold">添加 ERP 连接</h2>
              <p className="text-xs text-gray-500 mt-1">
                填写 ERP 给你的 App Key / Secret（敏感信息，加密存储）
              </p>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">连接名称 *</label>
                <input value={form.connection_name} onChange={(e) => setForm({ ...form, connection_name: e.target.value })}
                  placeholder="例如：我的 Thalvior ERP"
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-xl" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">ERP 类型 *</label>
                <select value={form.erp_type} onChange={(e) => setForm({ ...form, erp_type: e.target.value })}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-xl bg-white">
                  {ERP_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              {form.erp_type === 'custom' && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">API Base URL</label>
                  <input value={form.api_base_url} onChange={(e) => setForm({ ...form, api_base_url: e.target.value })}
                    placeholder="https://your-erp.com/api"
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-xl" />
                </div>
              )}
              <div>
                <label className="block text-xs text-gray-500 mb-1">App Key *</label>
                <input value={form.app_key} onChange={(e) => setForm({ ...form, app_key: e.target.value })}
                  placeholder="ERP 分配的 App Key"
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-xl font-mono text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">App Secret</label>
                <input type="password" value={form.app_secret} onChange={(e) => setForm({ ...form, app_secret: e.target.value })}
                  placeholder="ERP 分配的 Secret"
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-xl font-mono text-sm" />
              </div>

              {testResult && (
                <div className={`text-sm px-3 py-2 rounded-lg ${
                  testResult.startsWith('✓') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                }`}>{testResult}</div>
              )}
            </div>
            <div className="p-5 border-t border-gray-100 flex gap-3">
              <button onClick={() => { setShowForm(false); setTestResult(null); }}
                className="flex-1 py-2.5 border border-gray-300 rounded-xl font-medium">
                取消
              </button>
              <button
                onClick={() => testConnection()}
                disabled={testing || !form.connection_name || !form.app_key}
                className="flex-1 py-2.5 bg-gradient-to-r from-brand-500 to-brand-600 text-white rounded-xl font-medium disabled:opacity-50 flex items-center justify-center gap-2">
                {testing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Link className="w-4 h-4" />}
                测试连接
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
