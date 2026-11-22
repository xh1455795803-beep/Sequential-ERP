/* 塔奥 thalvior · 多店铺电商 ERP 前端 (React 18 + Ant Design 5) */
const { useState, useEffect, useRef, useCallback, useMemo } = React;
const {
  Layout, Menu, Table, Card, Statistic, Button, Modal, Form, Input, Select, Tag,
  Tabs, Row, Col, Space, Drawer, Switch, message, notification, Descriptions,
  Badge, Progress, Tooltip, Popconfirm, Divider, Alert, Empty, InputNumber,
  Checkbox, List, Steps, Timeline,
} = antd;
const { Header, Sider, Content } = Layout;
const { Option } = Select;
const { TextArea } = Input;

const API = "";
async function api(path, opts) {
  const r = await fetch(API + path, opts ? {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
  } : {});
  if (!r.ok) {
    const t = await r.text();
    throw new Error(t || r.statusText);
  }
  return r.json();
}
const post = (p, b) => api(p, { method: "POST", body: JSON.stringify(b || {}) });
const put = (p, b) => api(p, { method: "PUT", body: JSON.stringify(b || {}) });
const del = (p) => api(p, { method: "DELETE" });

const STATUS_COLOR = {
  pending: "blue", auditing: "orange", waiting: "cyan",
  shipped: "green", intercepted: "red", cancelled: "default", merged: "purple",
};
const money = (v) => "¥" + Number(v || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2 });

/* ============ 通用组件 ============ */
function EChart({ option, height = 260 }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    const c = echarts.init(ref.current);
    c.setOption(option);
    const h = () => c.resize();
    window.addEventListener("resize", h);
    return () => { window.removeEventListener("resize", h); c.dispose(); };
  }, [JSON.stringify(option)]);
  return React.createElement("div", { ref, style: { width: "100%", height } });
}

function Stat({ title, value, color, suffix, prefix }) {
  return React.createElement(Card, { size: "small", className: "stat-card" },
    React.createElement(Statistic, {
      title, value, suffix, prefix,
      valueStyle: { color: color || "#1677ff", fontSize: 22, fontWeight: 600 },
    }));
}

/* ============ 页面：经营概览 ============ */
function Dashboard() {
  const [d, setD] = useState(null);
  const load = () => api("/api/dashboard").then(setD);
  useEffect(() => { load(); }, []);
  if (!d) return React.createElement("div", { className: "loading" }, "加载中…");

  const trendOpt = {
    tooltip: { trigger: "axis" },
    legend: { data: ["订单量", "销售额"], bottom: 0 },
    grid: { left: 50, right: 50, top: 30, bottom: 40 },
    xAxis: { type: "category", data: d.trend.map((t) => t.date) },
    yAxis: [
      { type: "value", name: "单量" },
      { type: "value", name: "金额" },
    ],
    series: [
      { name: "订单量", type: "line", smooth: true, areaStyle: {}, data: d.trend.map((t) => t.orders), itemStyle: { color: "#1677ff" } },
      { name: "销售额", type: "bar", yAxisIndex: 1, data: d.trend.map((t) => t.amount), itemStyle: { color: "#91caff" } },
    ],
  };
  const rankOpt = {
    tooltip: { trigger: "axis" },
    grid: { left: 130, right: 40, top: 10, bottom: 20 },
    xAxis: { type: "value" },
    yAxis: { type: "category", data: d.shop_rank.map((s) => s.shop).reverse(), axisLabel: { fontSize: 11 } },
    series: [{ type: "bar", data: d.shop_rank.map((s) => s.amount).reverse(), itemStyle: { color: "#52c41a" } }],
  };
  const whOpt = {
    tooltip: { trigger: "item" },
    legend: { bottom: 0 },
    series: [{
      type: "pie", radius: ["42%", "68%"],
      data: d.wh_dist.map((w) => ({ name: w.name, value: w.available })),
    }],
  };

  return React.createElement("div", null,
    React.createElement(Row, { gutter: 12 },
      React.createElement(Col, { span: 6 }, React.createElement(Stat, { title: "在管店铺 / 平台", value: `${d.shops} / ${d.platforms}` })),
      React.createElement(Col, { span: 6 }, React.createElement(Stat, { title: "统一商品池 SKU", value: d.skus, suffix: "个", color: "#722ed1" })),
      React.createElement(Col, { span: 6 }, React.createElement(Stat, { title: "平台商品映射", value: d.listings, suffix: "条", color: "#13c2c2" })),
      React.createElement(Col, { span: 6 }, React.createElement(Stat, { title: "累计 GMV", value: d.gmv, prefix: "¥", color: "#52c41a" }))),
    React.createElement(Row, { gutter: 12, style: { marginTop: 12 } },
      React.createElement(Col, { span: 4 }, React.createElement(Stat, { title: "今日订单", value: d.today_orders, color: "#1677ff" })),
      React.createElement(Col, { span: 4 }, React.createElement(Stat, { title: "待审单", value: d.pending, color: "#fa8c16" })),
      React.createElement(Col, { span: 4 }, React.createElement(Stat, { title: "挂起待处理", value: d.auditing, color: "#faad14" })),
      React.createElement(Col, { span: 4 }, React.createElement(Stat, { title: "待发货", value: d.waiting, color: "#13c2c2" })),
      React.createElement(Col, { span: 4 }, React.createElement(Stat, { title: "已发货", value: d.shipped, color: "#52c41a" })),
      React.createElement(Col, { span: 4 }, React.createElement(Stat, { title: "已拦截", value: d.intercepted, color: "#f5222d" }))),
    React.createElement(Row, { gutter: 12, style: { marginTop: 12 } },
      React.createElement(Col, { span: 14 },
        React.createElement(Card, { title: "近 7 日订单与销售额趋势", size: "small" },
          React.createElement(EChart, { option: trendOpt }))),
      React.createElement(Col, { span: 10 },
        React.createElement(Card, { title: "仓库可用库存分布", size: "small" },
          React.createElement(EChart, { option: whOpt, height: 260 })))),
    React.createElement(Row, { gutter: 12, style: { marginTop: 12 } },
      React.createElement(Col, { span: 14 },
        React.createElement(Card, { title: "店铺销售额排行（TOP 10）", size: "small" },
          React.createElement(EChart, { option: rankOpt, height: 300 }))),
      React.createElement(Col, { span: 10 },
        React.createElement(Card, { title: "库存预警（可用 < 安全库存）", size: "small",
          extra: React.createElement(Tag, { color: "red" }, d.alerts.length + " 项") },
          React.createElement("div", { className: "scroll-box" },
            d.alerts.length ? d.alerts.map((a, i) =>
              React.createElement("div", { key: i, className: "alert-row" },
                React.createElement(Tag, { color: "red" }, "缺货风险"),
                React.createElement("span", { className: "mono" }, a.sku),
                React.createElement("span", null, a.name),
                React.createElement("span", { className: "dim" }, a.warehouse),
                React.createElement("b", { style: { color: "#f5222d" } }, `可用 ${a.available} / 安全 ${a.safety}`)))
              : React.createElement(Empty, { description: "暂无预警" }))))));
}

/* ============ 页面：多店铺管理 ============ */
function Shops() {
  const [rows, setRows] = useState([]);
  const [plats, setPlats] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", platform_id: "", entity: "", group: "默认分组" });
  const load = () => { api("/api/shops").then(setRows); api("/api/platforms").then(setPlats); };
  useEffect(() => { load(); }, []);

  const act = async (id, fn, msg_ok) => {
    try { await fn(); message.success(msg_ok); load(); }
    catch (e) { message.error(e.message); }
  };

  const groups = [...new Set(rows.map((r) => r.group))];
  const cols = [
    { title: "店铺编码", dataIndex: "code", width: 110, render: (v) => React.createElement("span", { className: "mono" }, v) },
    { title: "店铺名称", dataIndex: "name", width: 200 },
    { title: "平台", dataIndex: "platform", width: 90, render: (v) => React.createElement(Tag, { color: "blue" }, v) },
    { title: "店铺分组", dataIndex: "group", width: 100 },
    { title: "经营主体", dataIndex: "entity", width: 220 },
    { title: "授权", dataIndex: "auth_status", width: 100, render: (v) => v === "authorized"
      ? React.createElement(Badge, { status: "success", text: "已授权" })
      : React.createElement(Badge, { status: "error", text: "未授权" }) },
    { title: "授权日期", dataIndex: "authorized_at", width: 100 },
    { title: "商品映射", dataIndex: "listings", width: 80 },
    { title: "订单", dataIndex: "orders", width: 70 },
    { title: "API 用量/日", width: 130, dataIndex: "api_used",
      render: (v, r) => React.createElement(Progress, { percent: Math.min(100, Math.round(v / r.api_quota * 100)), size: "small" }) },
    { title: "操作", width: 150, fixed: "right", render: (_, r) => React.createElement(Space, null,
      r.auth_status === "authorized"
        ? React.createElement(Button, { size: "small", danger: true, onClick: () => act(r.id, () => post(`/api/shops/${r.id}/revoke`), "已解除授权") }, "解除")
        : React.createElement(Button, { size: "small", type: "primary", onClick: () => act(r.id, () => post(`/api/shops/${r.id}/auth`), "授权成功") }, "授权")) },
  ];

  return React.createElement("div", null,
    React.createElement(Card, { size: "small", style: { marginBottom: 12 },
      extra: React.createElement(Button, { type: "primary", onClick: () => setOpen(true) }, "+ 新增店铺") },
      React.createElement(Space, { size: 24 },
        React.createElement("span", null, "共 ", React.createElement("b", null, rows.length), " 家店铺"),
        React.createElement("span", null, "按分组：", groups.map((g) =>
          React.createElement(Tag, { key: g, color: "geekblue" }, `${g} ${rows.filter((r) => r.group === g).length}`))),
        React.createElement("span", null, "按主体：", [...new Set(rows.map((r) => r.entity))].length, " 个法人主体"))),
    React.createElement(Table, { rowKey: "id", size: "small", scroll: { x: 1400 },
      dataSource: rows, columns: cols, pagination: false }),
    React.createElement(Modal, { open, title: "新增店铺（模拟 OAuth 授权）", onCancel: () => setOpen(false),
      onOk: async () => {
        try { await post("/api/shops", { ...form, platform_id: Number(form.platform_id) });
          message.success("已创建，请在列表中点击授权"); setOpen(false); load(); }
        catch (e) { message.error(e.message); }
      } },
      React.createElement(Form, { layout: "vertical" },
        React.createElement(Form.Item, { label: "店铺编码" },
          React.createElement(Input, { value: form.code, onChange: (e) => setForm({ ...form, code: e.target.value }), placeholder: "如 TB-003" })),
        React.createElement(Form.Item, { label: "店铺名称" },
          React.createElement(Input, { value: form.name, onChange: (e) => setForm({ ...form, name: e.target.value }) })),
        React.createElement(Form.Item, { label: "所属平台" },
          React.createElement(Select, { style: { width: "100%" }, value: form.platform_id || undefined,
            onChange: (v) => setForm({ ...form, platform_id: v }) },
            plats.map((p) => React.createElement(Option, { key: p.id, value: p.id }, p.name)))),
        React.createElement(Form.Item, { label: "经营主体（法人）" },
          React.createElement(Input, { value: form.entity, onChange: (e) => setForm({ ...form, entity: e.target.value }) })),
        React.createElement(Form.Item, { label: "店铺分组" },
          React.createElement(Input, { value: form.group, onChange: (e) => setForm({ ...form, group: e.target.value }) })))));
}

/* ============ 页面：商品中心 ============ */
function Products() {
  const [rows, setRows] = useState([]);
  const [listings, setListings] = useState([]);
  const [kw, setKw] = useState("");
  const [shops, setShops] = useState([]);
  const [shopFilter, setShopFilter] = useState(0);
  const load = () => {
    api("/api/products?kw=" + kw).then(setRows);
    api("/api/listings?shop_id=" + shopFilter).then(setListings);
    api("/api/shops").then(setShops);
  };
  useEffect(() => { load(); }, [shopFilter]);

  const cols = [
    { title: "系统SKU", dataIndex: "sku", width: 130, render: (v) => React.createElement("span", { className: "mono" }, v) },
    { title: "商品名称", dataIndex: "name", width: 200 },
    { title: "分类", dataIndex: "category", width: 90 },
    { title: "规格", dataIndex: "spec", width: 110 },
    { title: "成本", dataIndex: "cost_price", width: 80, render: money },
    { title: "售价", dataIndex: "sale_price", width: 80, render: money },
    { title: "重量(kg)", dataIndex: "weight_kg", width: 80 },
    { title: "全渠道可用", dataIndex: "available", width: 100,
      render: (v) => React.createElement("b", { style: { color: v < 20 ? "#f5222d" : "#52c41a" } }, v) },
    { title: "已铺店铺", dataIndex: "shop_count", width: 90 },
    { title: "组合装", dataIndex: "is_bundle", width: 150,
      render: (v, r) => v ? React.createElement("span", null,
        React.createElement(Tag, { color: "purple" }, "组合装"),
        r.bundle.map((b, i) => React.createElement("span", { key: i, className: "dim mono" }, `${b.sku}×${b.qty} `)))
        : React.createElement("span", { className: "dim" }, "单品") },
  ];
  const lcols = [
    { title: "店铺", dataIndex: "shop", width: 170 },
    { title: "系统SKU", dataIndex: "sku", width: 130, render: (v) => React.createElement("span", { className: "mono" }, v) },
    { title: "商品", dataIndex: "name", width: 180 },
    { title: "平台商品ID", dataIndex: "platform_item_id", width: 160, render: (v) => React.createElement("span", { className: "mono dim" }, v) },
    { title: "平台标题", dataIndex: "platform_title", width: 200 },
    { title: "平台价", dataIndex: "platform_price", width: 90, render: money },
    { title: "与标准价差", dataIndex: "diff_price", width: 100,
      render: (v) => React.createElement("span", { style: { color: v < 0 ? "#f5222d" : "#52c41a" } }, (v > 0 ? "+" : "") + v.toFixed(2)) },
    { title: "平台库存", dataIndex: "platform_stock", width: 90 },
    { title: "状态", dataIndex: "online_status", width: 80,
      render: (v) => React.createElement(Tag, { color: v === "online" ? "green" : "default" }, v === "online" ? "在售" : "下架") },
  ];

  return React.createElement("div", null,
    React.createElement(Tabs, { items: [
      { key: "1", label: `统一商品池（${rows.length}）`, children: React.createElement("div", null,
        React.createElement(Card, { size: "small", style: { marginBottom: 12 } },
          React.createElement(Space, null,
            React.createElement(Input.Search, { placeholder: "搜索 SKU 或商品名", style: { width: 260 },
              onSearch: (v) => { setKw(v); api("/api/products?kw=" + v).then(setRows); } }),
            React.createElement("span", { className: "dim" }, "一个系统 SKU 可映射到多个平台的多个商品，库存统一扣减"))),
        React.createElement(Table, { rowKey: "id", size: "small", scroll: { x: 1300 }, columns: cols, dataSource: rows, pagination: { pageSize: 12 } })) },
      { key: "2", label: `平台商品映射（${listings.length}）`, children: React.createElement("div", null,
        React.createElement(Card, { size: "small", style: { marginBottom: 12 } },
          React.createElement(Space, null,
            React.createElement("span", null, "店铺筛选"),
            React.createElement(Select, { style: { width: 220 }, value: shopFilter || undefined,
              onChange: (v) => setShopFilter(v || 0) },
              React.createElement(Option, { value: 0 }, "全部店铺"),
              shops.map((s) => React.createElement(Option, { key: s.id, value: s.id }, s.name)))),
          React.createElement("div", { className: "dim", style: { marginTop: 6 } },
            "发货后系统按统一库存池自动回写各平台可售库存，避免多店铺超卖")),
        React.createElement(Table, { rowKey: "id", size: "small", scroll: { x: 1300 }, columns: lcols, dataSource: listings, pagination: { pageSize: 12 } })) },
    ] }));
}

/* ============ 页面：库存中心 ============ */
function InventoryPage() {
  const [rows, setRows] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [rules, setRules] = useState([]);
  const [whs, setWhs] = useState([]);
  const [alertOnly, setAlertOnly] = useState(false);
  const [kw, setKw] = useState("");
  const [adj, setAdj] = useState(null);
  const load = useCallback(() => {
    api("/api/inventory?kw=" + kw + "&alert_only=" + alertOnly).then(setRows);
    api("/api/stock-ledger").then(setLedger);
    api("/api/stock-rules").then(setRules);
    api("/api/warehouses").then(setWhs);
  }, [kw, alertOnly]);
  useEffect(() => { load(); }, [load]);

  const cols = [
    { title: "仓库", dataIndex: "warehouse", width: 140 },
    { title: "SKU", dataIndex: "sku", width: 120, render: (v) => React.createElement("span", { className: "mono" }, v) },
    { title: "商品", dataIndex: "name", width: 190 },
    { title: "实物", dataIndex: "on_hand", width: 70 },
    { title: "锁定", dataIndex: "locked", width: 70, render: (v) => React.createElement("span", { style: { color: v ? "#fa8c16" : "#999" } }, v) },
    { title: "预留", dataIndex: "reserved", width: 70 },
    { title: "在途", dataIndex: "inbound", width: 70 },
    { title: "安全库存", dataIndex: "safety_stock", width: 90 },
    { title: "可用库存", dataIndex: "available", width: 100,
      render: (v, r) => React.createElement("b", { style: { color: r.alert ? "#f5222d" : "#52c41a" } }, v) },
    { title: "状态", dataIndex: "alert", width: 90,
      render: (v) => v ? React.createElement(Tag, { color: "red" }, "低于安全线") : React.createElement(Tag, { color: "green" }, "正常") },
    { title: "操作", width: 90, render: (_, r) => React.createElement(Button, { size: "small", onClick: () => setAdj({ ...r, qty: 10 }) }, "调整") },
  ];
  const lcols = [
    { title: "时间", dataIndex: "time", width: 110 },
    { title: "仓库", dataIndex: "warehouse", width: 130 },
    { title: "SKU", dataIndex: "sku", width: 120, render: (v) => React.createElement("span", { className: "mono" }, v) },
    { title: "商品", dataIndex: "name", width: 180 },
    { title: "变动类型", dataIndex: "type", width: 110, render: (v) => React.createElement(Tag, { color: { lock: "orange", unlock: "blue", ship: "green", adjust: "purple", purchase: "cyan", return_in: "geekblue" }[v] || "default" }, v) },
    { title: "变动量", dataIndex: "qty", width: 80, render: (v) => React.createElement("b", { style: { color: v > 0 ? "#52c41a" : "#f5222d" } }, v > 0 ? "+" + v : v) },
    { title: "变动前可用", dataIndex: "before", width: 100 },
    { title: "变动后可用", dataIndex: "after", width: 100 },
    { title: "关联单据", dataIndex: "ref", width: 150 },
    { title: "操作人", dataIndex: "operator", width: 90 },
  ];
  const rcols = [
    { title: "规则名称", dataIndex: "name", width: 200 },
    { title: "适用范围", dataIndex: "scope", width: 180 },
    { title: "发货仓", dataIndex: "warehouse", width: 150 },
    { title: "优先级", dataIndex: "priority", width: 80 },
    { title: "可出货比例", dataIndex: "share_ratio", width: 110, render: (v) => Math.round(v * 100) + "%" },
    { title: "状态", dataIndex: "enabled", width: 80, render: (v) => React.createElement(Tag, { color: v ? "green" : "default" }, v ? "启用" : "停用") },
  ];

  return React.createElement("div", null,
    React.createElement(Row, { gutter: 12, style: { marginBottom: 12 } },
      whs.map((w) => React.createElement(Col, { span: 8, key: w.id },
        React.createElement(Card, { size: "small", title: `${w.name}（${w.wtype}·${w.city}）` },
          React.createElement(Row, { gutter: 8 },
            React.createElement(Col, { span: 8 }, React.createElement(Statistic, { title: "实物", value: w.on_hand })),
            React.createElement(Col, { span: 8 }, React.createElement(Statistic, { title: "锁定", value: w.locked, valueStyle: { color: "#fa8c16" } })),
            React.createElement(Col, { span: 8 }, React.createElement(Statistic, { title: "可用", value: w.available, valueStyle: { color: "#52c41a" } }))))))),
    React.createElement(Tabs, { items: [
      { key: "1", label: "库存池", children: React.createElement("div", null,
        React.createElement(Card, { size: "small", style: { marginBottom: 12 } },
          React.createElement(Space, null,
            React.createElement(Input.Search, { placeholder: "搜索 SKU / 商品名", style: { width: 240 },
              onChange: (e) => setKw(e.target.value), onSearch: (v) => setKw(v) }),
            React.createElement(Checkbox, { checked: alertOnly, onChange: (e) => setAlertOnly(e.target.checked) }, "仅看预警"),
            React.createElement("span", { className: "dim" }, "可用 = 实物 − 锁定 − 预留（在途不计入可售）"))),
        React.createElement(Table, { rowKey: "id", size: "small", scroll: { x: 1250 }, columns: cols, dataSource: rows, pagination: { pageSize: 12 } })) },
      { key: "2", label: "库存流水", children: React.createElement(Table, { rowKey: "id", size: "small", scroll: { x: 1200 }, columns: lcols, dataSource: ledger, pagination: { pageSize: 12 } }) },
      { key: "3", label: "库存分配规则", children: React.createElement("div", null,
        React.createElement(Alert, { type: "info", showIcon: true, style: { marginBottom: 12 },
          message: "多店铺共享一个库存池时，按优先级选仓；可出货比例用于给某渠道/店铺预留库存，避免单一店铺把货卖空。" }),
        React.createElement(Table, { rowKey: "id", size: "small", columns: rcols, dataSource: rules, pagination: false })) },
    ] }),
    React.createElement(Modal, { open: !!adj, title: "库存调整", onCancel: () => setAdj(null),
      onOk: async () => {
        try { await post("/api/inventory/adjust", { warehouse_id: adj.id, product_id: 0, qty: adj.qty }); }
        catch (e) {}
        message.info("演示环境：调整需传 warehouse_id + product_id，请在库存池中操作");
        setAdj(null);
      } },
      adj ? React.createElement("div", null,
        React.createElement("p", null, adj.sku, " ", adj.name, " · ", adj.warehouse),
        React.createElement(InputNumber, { value: adj.qty, onChange: (v) => setAdj({ ...adj, qty: v }) })) : null));
}

/* ============ 页面：订单中心（核心） ============ */
function Orders({ onNotify }) {
  const [rows, setRows] = useState([]);
  const [shops, setShops] = useState([]);
  const [tab, setTab] = useState("");
  const [kw, setKw] = useState("");
  const [sel, setSel] = useState([]);
  const [detail, setDetail] = useState(null);
  const [sim, setSim] = useState(false);
  const [simResult, setSimResult] = useState(null);
  const [simForm, setSimForm] = useState({ count: 5, shop_id: 0, product_sku: "", qty: 2, auto_audit: true });
  const [print, setPrint] = useState(null);

  const load = useCallback(() => {
    api(`/api/orders?status=${tab}&kw=${kw}`).then(setRows);
  }, [tab, kw]);
  useEffect(() => { load(); api("/api/shops").then(setShops); }, [load]);

  const doAct = async (fn, ok) => {
    try { const r = await fn(); message.success(ok || (r && r.msg) || "操作成功"); load(); if (r) return r; }
    catch (e) { message.error(e.message); }
  };

  const cols = [
    { title: "订单号", dataIndex: "order_no", width: 170, render: (v, r) =>
      React.createElement("a", { onClick: () => api("/api/orders/" + r.id).then(setDetail) }, React.createElement("span", { className: "mono" }, v)) },
    { title: "店铺", dataIndex: "shop", width: 160 },
    { title: "平台", dataIndex: "platform", width: 80, render: (v) => React.createElement(Tag, { color: "blue" }, v) },
    { title: "买家/收件", width: 150, render: (_, r) => React.createElement("div", null,
      React.createElement("div", null, r.receiver),
      React.createElement("div", { className: "dim mono" }, r.phone)) },
    { title: "收货地", width: 150, render: (_, r) => `${r.province}${r.city}` },
    { title: "金额", dataIndex: "amount", width: 90, render: money },
    { title: "状态", dataIndex: "status_label", width: 100,
      render: (v, r) => React.createElement(Tag, { color: STATUS_COLOR[r.status] }, v) },
    { title: "审核结果", width: 200, dataIndex: "audit_msg",
      render: (v, r) => React.createElement("div", { className: "audit-msg" },
        r.audit_result ? React.createElement(Tag, { color: { pass: "green", hold: "orange", block: "red" }[r.audit_result] }, r.audit_result) : null,
        React.createElement("span", { className: "dim" }, v)) },
    { title: "发货仓", dataIndex: "warehouse", width: 120 },
    { title: "快递", dataIndex: "carrier", width: 90 },
    { title: "运单号", dataIndex: "waybill_no", width: 150, render: (v) => v ? React.createElement("span", { className: "mono" }, v) : null },
    { title: "操作", width: 260, fixed: "right", render: (_, r) => React.createElement(Space, { size: 4, wrap: true },
      (r.status === "pending" || r.status === "auditing") &&
        React.createElement(Button, { size: "small", type: "primary", onClick: () => doAct(() => post(`/api/orders/${r.id}/audit`)) }, "审单"),
      (r.status === "auditing") &&
        React.createElement(Button, { size: "small", onClick: () => doAct(() => post(`/api/orders/${r.id}/approve`)) }, "人工放行"),
      r.status === "waiting" &&
        React.createElement(Button, { size: "small", type: "primary", onClick: () => doAct(() => post(`/api/orders/${r.id}/ship`)) }, "发货"),
      r.status === "waiting" &&
        React.createElement(Button, { size: "small", onClick: () => setPrint(r) }, "打单"),
      (r.status === "pending" || r.status === "auditing" || r.status === "waiting") &&
        React.createElement(Button, { size: "small", onClick: () => doAct(() => post(`/api/orders/${r.id}/split`)) }, "拆单"),
      (r.status === "pending" || r.status === "auditing" || r.status === "waiting") &&
        React.createElement(Popconfirm, { title: "确认拦截该订单？", onConfirm: () => doAct(() => post(`/api/orders/${r.id}/intercept`)) },
          React.createElement(Button, { size: "small", danger: true }, "拦截"))) },
  ];

  const TABS = [
    { key: "", label: "全部" }, { key: "pending", label: "待审单" },
    { key: "auditing", label: "挂起待处理" }, { key: "waiting", label: "待发货" },
    { key: "shipped", label: "已发货" }, { key: "intercepted", label: "已拦截" },
  ];

  return React.createElement("div", null,
    React.createElement(Card, { size: "small", style: { marginBottom: 12 } },
      React.createElement(Space, { wrap: true },
        React.createElement(Button, { type: "primary", onClick: () => setSim(true) }, "模拟平台推单"),
        React.createElement(Input.Search, { placeholder: "订单号 / 买家 / 收件人", style: { width: 220 },
          onChange: (e) => setKw(e.target.value), onSearch: (v) => setKw(v) }),
        React.createElement("span", { className: "dim" }, `已选 ${sel.length} 单`),
        React.createElement(Button, { disabled: !sel.length, onClick: async () => {
          const r = await post("/api/orders/batch-audit", { ids: sel });
          notification.info({ message: `批量审单结果：通过 ${r.pass} / 挂起 ${r.hold} / 拦截 ${r.block}`, description: (r.msgs || []).join("；") });
          load(); setSel([]);
        } }, "批量审单"),
        React.createElement(Button, { disabled: !sel.length, onClick: async () => {
          const r = await post("/api/orders/batch-ship", { ids: sel });
          message.success(`发货成功 ${r.ok} 单，跳过 ${r.fail} 单`); load(); setSel([]);
        } }, "批量发货"),
        React.createElement(Button, { disabled: sel.length < 2, onClick: async () => {
          const r = await post("/api/orders/merge", { ids: sel });
          r.ok ? message.success(`已合并为 ${r.order_no}，共 ${r.count} 单`) : message.warning(r.msg);
          load(); setSel([]);
        } }, "同买家合单"))),
    React.createElement(Tabs, { activeKey: tab || "", onChange: (k) => setTab(k), items: TABS.map((t) => ({ key: t.key, label: t.label })) }),
    React.createElement(Table, { rowKey: "id", size: "small", scroll: { x: 1900 }, columns: cols, dataSource: rows,
      pagination: { pageSize: 15 },
      rowSelection: { selectedRowKeys: sel, onChange: setSel } }),

    React.createElement(Drawer, { open: !!detail, title: detail ? `订单明细 ${detail.order_no}` : "", width: 620,
      onClose: () => setDetail(null) },
      detail ? React.createElement("div", null,
        React.createElement(Descriptions, { bordered: true, size: "small", column: 2 },
          React.createElement(Descriptions.Item, { label: "店铺" }, detail.shop),
          React.createElement(Descriptions.Item, { label: "平台" }, detail.platform),
          React.createElement(Descriptions.Item, { label: "买家" }, detail.buyer_nick),
          React.createElement(Descriptions.Item, { label: "收件人" }, `${detail.receiver} ${detail.phone}`),
          React.createElement(Descriptions.Item, { label: "收货地址", span: 2 }, `${detail.province}${detail.city}${detail.address}`),
          React.createElement(Descriptions.Item, { label: "订单金额" }, money(detail.amount)),
          React.createElement(Descriptions.Item, { label: "运费" }, money(detail.freight)),
          React.createElement(Descriptions.Item, { label: "状态" }, React.createElement(Tag, { color: STATUS_COLOR[detail.status] }, detail.status_label)),
          React.createElement(Descriptions.Item, { label: "发货仓" }, detail.warehouse || "-"),
          React.createElement(Descriptions.Item, { label: "快递" }, detail.carrier || "-"),
          React.createElement(Descriptions.Item, { label: "运单号" }, detail.waybill_no || "-"),
          React.createElement(Descriptions.Item, { label: "买家备注", span: 2 }, detail.remark || "-"),
          React.createElement(Descriptions.Item, { label: "审核结果", span: 2 }, detail.audit_msg || "-")),
        React.createElement(Divider, null, "商品明细"),
        React.createElement(Table, { size: "small", rowKey: "sku", pagination: false,
          dataSource: detail.items || [],
          columns: [
            { title: "SKU", dataIndex: "sku", render: (v) => React.createElement("span", { className: "mono" }, v) },
            { title: "商品", dataIndex: "name" },
            { title: "单价", dataIndex: "price", render: money },
            { title: "数量", dataIndex: "qty" },
            { title: "小计", render: (_, r) => money(r.price * r.qty) },
          ] })) : null),

    React.createElement(Modal, { open: sim, title: "模拟平台推单（抓单 → 审单 → 锁库存）", width: 760,
      onCancel: () => setSim(false), onOk: async () => {
        const r = await post("/api/simulate/inbound", simForm);
        setSimResult(r.results); setSim(false); load();
      } },
      React.createElement(Form, { layout: "vertical" },
        React.createElement(Row, { gutter: 12 },
          React.createElement(Col, { span: 8 }, React.createElement(Form.Item, { label: "推单笔数" },
            React.createElement(InputNumber, { min: 1, max: 50, value: simForm.count, style: { width: "100%" },
              onChange: (v) => setSimForm({ ...simForm, count: v }) }))),
          React.createElement(Col, { span: 8 }, React.createElement(Form.Item, { label: "指定店铺" },
            React.createElement(Select, { style: { width: "100%" }, value: simForm.shop_id || undefined,
              onChange: (v) => setSimForm({ ...simForm, shop_id: v || 0 }) },
              React.createElement(Option, { value: 0 }, "随机"),
              shops.map((s) => React.createElement(Option, { key: s.id, value: s.id }, s.name))))),
          React.createElement(Col, { span: 8 }, React.createElement(Form.Item, { label: "指定商品SKU" },
            React.createElement(Input, { placeholder: "留空随机，如 SKU-1009", value: simForm.product_sku,
              onChange: (e) => setSimForm({ ...simForm, product_sku: e.target.value }) })))),
        React.createElement(Row, { gutter: 12 },
          React.createElement(Col, { span: 8 }, React.createElement(Form.Item, { label: "每单件数" },
            React.createElement(InputNumber, { min: 1, max: 50, value: simForm.qty, style: { width: "100%" },
              onChange: (v) => setSimForm({ ...simForm, qty: v }) }))),
          React.createElement(Col, { span: 16 }, React.createElement(Form.Item, { label: " " },
            React.createElement(Checkbox, { checked: simForm.auto_audit, onChange: (e) => setSimForm({ ...simForm, auto_audit: e.target.checked }) },
              "推单后立即执行审单规则并锁定库存")))),
        React.createElement(Alert, { type: "warning", showIcon: true, style: { marginTop: 8 },
          message: "防超卖演示：指定 SKU-1009（紧缺品），推 15 单 × 每单 3 件，可看到前几单通过锁定、后续订单因库存不足被挂起。" }))),

    simResult ? React.createElement(Card, { size: "small", title: "推单结果", style: { marginTop: 12 },
      extra: React.createElement(Button, { size: "small", onClick: () => setSimResult(null) }, "关闭") },
      React.createElement(List, { size: "small", dataSource: simResult,
        renderItem: (r) => React.createElement(List.Item, null,
          React.createElement(Space, null,
            React.createElement("span", { className: "mono" }, r.order_no),
            React.createElement(Tag, null, r.shop),
            React.createElement("span", { className: "dim" }, money(r.amount)),
            React.createElement(Tag, { color: { pass: "green", hold: "orange", block: "red", pending: "blue" }[r.action] }, r.action),
            React.createElement("span", { className: "dim" }, r.msg))) })) : null,

    print ? React.createElement(Modal, { open: true, title: `打单 · ${print.order_no}`, width: 900,
      onCancel: () => setPrint(null), footer: null },
      React.createElement(PrintPreview, { order: print })) : null);
}

/* ============ 打印预览 ============ */
function PrintPreview({ order }) {
  const [tpl, setTpl] = useState("waybill_default");
  const [html, setHtml] = useState("");
  const [meta, setMeta] = useState({});
  const [tpls, setTpls] = useState([]);
  useEffect(() => {
    api("/api/templates").then((t) => setTpls(t.filter((x) => x.enabled)));
  }, []);
  useEffect(() => {
    api(`/api/orders/${order.id}/print?tpl=${tpl}`).then((r) => { setHtml(r.html); setMeta(r); });
  }, [tpl, order.id]);
  return React.createElement("div", null,
    React.createElement(Space, { style: { marginBottom: 12 } },
      React.createElement("span", null, "选择单据模板："),
      React.createElement(Select, { style: { width: 260 }, value: tpl, onChange: setTpl },
        tpls.map((t) => React.createElement(Option, { key: t.code, value: t.code }, `${t.name}（${t.paper}mm）`))),
      React.createElement(Button, { onClick: () => {
        const w = window.open("", "_blank");
        w.document.write(`<html><head><title>打印</title><style>@page{size:${meta.w}mm ${meta.h}mm;margin:0}body{margin:0;font-family:'Noto Sans CJK SC',sans-serif}</style></head><body>${html}<script>window.print()<\/script></body></html>`);
        w.document.close();
      } }, "调用打印机")),
    React.createElement("div", { className: "paper-wrap" },
      React.createElement("div", { className: "paper", style: { width: meta.w + "mm", minHeight: meta.h + "mm" },
        dangerouslySetInnerHTML: { __html: html } })));
}

/* ============ 页面：打印模板中心 ============ */
function Templates() {
  const [tpls, setTpls] = useState([]);
  const [cur, setCur] = useState(null);
  const [vars, setVars] = useState([]);
  const [html, setHtml] = useState("");
  const [meta, setMeta] = useState({});
  useEffect(() => { api("/api/templates").then(setTpls); api("/api/template-vars").then(setVars); }, []);
  const open = async (id) => {
    const t = await api("/api/templates/" + id);
    setCur(t);
    const r = await api(`/api/templates/${id}/preview`);
    setHtml(r.html); setMeta(r);
  };
  const save = async () => {
    await put(`/api/templates/${cur.id}`, { name: cur.name, content: cur.content, width_mm: cur.width_mm, height_mm: cur.height_mm });
    message.success("模板已保存");
    const r = await api(`/api/templates/${cur.id}/preview`);
    setHtml(r.html); setMeta(r);
    api("/api/templates").then(setTpls);
  };
  const insert = (k) => setCur({ ...cur, content: cur.content + `{{${k}}}` });

  return React.createElement(Row, { gutter: 12 },
    React.createElement(Col, { span: 6 },
      React.createElement(Card, { size: "small", title: "单据模板" },
        React.createElement(List, { size: "small", dataSource: tpls,
          renderItem: (t) => React.createElement(List.Item, {
            onClick: () => open(t.id), className: cur && cur.id === t.id ? "tpl-active" : "tpl-item" },
            React.createElement("div", null,
              React.createElement("div", null, React.createElement("b", null, t.name)),
              React.createElement("div", { className: "dim" }, `${t.ttype} · ${t.paper}mm · 更新 ${t.updated_at}`))) }))),
    React.createElement(Col, { span: 10 },
      React.createElement(Card, { size: "small", title: cur ? `编辑：${cur.name}` : "选择左侧模板",
        extra: cur ? React.createElement(Button, { type: "primary", size: "small", onClick: save }, "保存并预览") : null },
        cur ? React.createElement("div", null,
          React.createElement(Space, { style: { marginBottom: 8 } },
            React.createElement("span", null, "纸张 宽"),
            React.createElement(InputNumber, { size: "small", value: cur.width_mm, onChange: (v) => setCur({ ...cur, width_mm: v }) }),
            React.createElement("span", null, "mm 高"),
            React.createElement(InputNumber, { size: "small", value: cur.height_mm, onChange: (v) => setCur({ ...cur, height_mm: v }) }),
            React.createElement("span", null, "mm")),
          React.createElement(TextArea, { value: cur.content, rows: 20, className: "mono",
            onChange: (e) => setCur({ ...cur, content: e.target.value }) }),
          React.createElement(Divider, { plain: true }, "可用变量（点击插入）"),
          React.createElement("div", null, vars.map((v) =>
            React.createElement(Tag, { key: v.key, style: { cursor: "pointer", marginBottom: 4 },
              onClick: () => insert(v.key), title: `${v.desc} 示例：${v.sample}` }, `{{${v.key}}}`))))
          : React.createElement(Empty, { description: "请选择模板" }))),
    React.createElement(Col, { span: 8 },
      React.createElement(Card, { size: "small", title: "实时预览（真实订单渲染）" },
        html ? React.createElement("div", null,
          React.createElement("div", { className: "dim", style: { marginBottom: 6 } }, `示例订单 ${meta.order_no} · ${meta.w}×${meta.h}mm`),
          React.createElement("div", { className: "paper-wrap" },
            React.createElement("div", { className: "paper", style: { width: meta.w + "mm", minHeight: meta.h + "mm" },
              dangerouslySetInnerHTML: { __html: html }})))
          : React.createElement(Empty, { description: "暂无预览" }))));
}

/* ============ 页面：规则引擎 ============ */
function Rules() {
  const [audit, setAudit] = useState([]);
  const [ship, setShip] = useState([]);
  const [stock, setStock] = useState([]);
  const [carriers, setCarriers] = useState([]);
  const [add, setAdd] = useState(null);
  const load = () => {
    api("/api/audit-rules").then(setAudit);
    api("/api/ship-rules").then(setShip);
    api("/api/stock-rules").then(setStock);
    api("/api/carriers").then(setCarriers);
  };
  useEffect(() => { load(); }, []);

  const acols = [
    { title: "优先级", dataIndex: "priority", width: 70 },
    { title: "规则名称", dataIndex: "name", width: 180 },
    { title: "条件", width: 240, render: (_, r) => React.createElement("span", null,
      React.createElement(Tag, null, { min_amount: "金额≥", max_amount: "金额≤", address_contains: "地址含",
        remark_contains: "备注含", platform: "平台=", shop: "店铺=", out_of_stock: "缺货" }[r.cond_type] || r.cond_type),
      React.createElement("span", { className: "mono" }, r.cond_value || "-")) },
    { title: "动作", dataIndex: "action", width: 90, render: (v) => React.createElement(Tag,
      { color: { pass: "green", hold: "orange", block: "red" }[v] }, { pass: "通过", hold: "挂起", block: "拦截" }[v]) },
    { title: "原因说明", dataIndex: "reason", width: 220 },
    { title: "操作", width: 70, render: (_, r) => React.createElement(Popconfirm, { title: "删除该规则？",
      onConfirm: async () => { await del("/api/audit-rules/" + r.id); message.success("已删除"); load(); } },
      React.createElement(Button, { size: "small", danger: true }, "删除")) },
  ];
  const scols = [
    { title: "优先级", dataIndex: "priority", width: 70 },
    { title: "规则名称", dataIndex: "name", width: 180 },
    { title: "适用店铺", dataIndex: "shop", width: 150 },
    { title: "省份关键字", dataIndex: "province_key", width: 160, render: (v) => v || React.createElement("span", { className: "dim" }, "不限") },
    { title: "重量≤", dataIndex: "max_weight", width: 80 },
    { title: "金额≥", dataIndex: "min_amount", width: 80 },
    { title: "指定快递", dataIndex: "carrier", width: 110, render: (v) => React.createElement(Tag, { color: "blue" }, v) },
    { title: "操作", width: 70, render: (_, r) => React.createElement(Popconfirm, { title: "删除？",
      onConfirm: async () => { await del("/api/ship-rules/" + r.id); load(); } },
      React.createElement(Button, { size: "small", danger: true }, "删除")) },
  ];
  const stcols = [
    { title: "规则名称", dataIndex: "name", width: 200 },
    { title: "适用范围", dataIndex: "scope", width: 180 },
    { title: "发货仓", dataIndex: "warehouse", width: 150 },
    { title: "优先级", dataIndex: "priority", width: 80 },
    { title: "可出货比例", dataIndex: "share_ratio", width: 100, render: (v) => Math.round(v * 100) + "%" },
  ];

  return React.createElement("div", null,
    React.createElement(Alert, { type: "info", showIcon: true, style: { marginBottom: 12 },
      message: "规则引擎是自动化上限：条件 → 动作 → 优先级 → 例外。命中高优先级规则即停止匹配。" }),
    React.createElement(Tabs, { items: [
      { key: "1", label: `审单规则（${audit.length}）`, children: React.createElement("div", null,
        React.createElement(Space, { style: { marginBottom: 10 } },
          React.createElement(Button, { type: "primary", size: "small", onClick: () => setAdd({ type: "audit", priority: 10, cond_type: "min_amount", action: "hold", name: "", cond_value: "", reason: "" }) }, "+ 新增审单规则")),
        React.createElement(Table, { rowKey: "id", size: "small", columns: acols, dataSource: audit, pagination: false })) },
      { key: "2", label: `快递分配规则（${ship.length}）`, children: React.createElement("div", null,
        React.createElement(Space, { style: { marginBottom: 10 } },
          React.createElement(Button, { type: "primary", size: "small", onClick: () => setAdd({ type: "ship", name: "", priority: 10, province_key: "", max_weight: 9999, min_amount: 0, shop_id: 0, carrier_id: carriers[0] && carriers[0].id }) }, "+ 新增快递规则")),
        React.createElement(Table, { rowKey: "id", size: "small", columns: scols, dataSource: ship, pagination: false }),
        React.createElement(Divider, null, "快递公司资费"),
        React.createElement(Table, { rowKey: "id", size: "small", pagination: false, dataSource: carriers,
          columns: [
            { title: "快递", dataIndex: "name" }, { title: "首重(元)", dataIndex: "base_fee" },
            { title: "续重/kg", dataIndex: "per_kg_fee" }, { title: "偏远附加", dataIndex: "remote_surcharge" },
            { title: "状态", dataIndex: "enabled", render: (v) => React.createElement(Tag, { color: v ? "green" : "default" }, v ? "启用" : "停用") },
          ] })) },
      { key: "3", label: `库存分配规则（${stock.length}）`, children:
        React.createElement(Table, { rowKey: "id", size: "small", columns: stcols, dataSource: stock, pagination: false }) },
    ] }),
    React.createElement(Modal, { open: !!add, title: add && add.type === "audit" ? "新增审单规则" : "新增快递规则",
      onCancel: () => setAdd(null), onOk: async () => {
        const p = add.type === "audit" ? "/api/audit-rules" : "/api/ship-rules";
        const body = { ...add }; delete body.type;
        await post(p, body); message.success("已新增"); setAdd(null); load();
      } },
      add ? React.createElement(Form, { layout: "vertical" },
        React.createElement(Form.Item, { label: "规则名称" },
          React.createElement(Input, { value: add.name, onChange: (e) => setAdd({ ...add, name: e.target.value }) })),
        React.createElement(Form.Item, { label: "优先级（小者优先）" },
          React.createElement(InputNumber, { value: add.priority, onChange: (v) => setAdd({ ...add, priority: v }) })),
        add.type === "audit" ? React.createElement("div", null,
          React.createElement(Form.Item, { label: "条件类型" },
            React.createElement(Select, { style: { width: "100%" }, value: add.cond_type, onChange: (v) => setAdd({ ...add, cond_type: v }) },
              React.createElement(Option, { value: "min_amount" }, "订单金额 ≥"),
              React.createElement(Option, { value: "max_amount" }, "订单金额 ≤"),
              React.createElement(Option, { value: "address_contains" }, "收货地址包含"),
              React.createElement(Option, { value: "remark_contains" }, "买家备注包含"),
              React.createElement(Option, { value: "platform" }, "平台ID等于"),
              React.createElement(Option, { value: "shop" }, "店铺ID等于"),
              React.createElement(Option, { value: "out_of_stock" }, "库存不足"))),
          React.createElement(Form.Item, { label: "条件值" },
            React.createElement(Input, { value: add.cond_value, onChange: (e) => setAdd({ ...add, cond_value: e.target.value }) })),
          React.createElement(Form.Item, { label: "动作" },
            React.createElement(Select, { style: { width: "100%" }, value: add.action, onChange: (v) => setAdd({ ...add, action: v }) },
              React.createElement(Option, { value: "pass" }, "通过"),
              React.createElement(Option, { value: "hold" }, "挂起转人工"),
              React.createElement(Option, { value: "block" }, "直接拦截"))),
          React.createElement(Form.Item, { label: "原因说明" },
            React.createElement(Input, { value: add.reason, onChange: (e) => setAdd({ ...add, reason: e.target.value }) })))
          : React.createElement("div", null,
            React.createElement(Form.Item, { label: "省份关键字（逗号分隔，留空不限）" },
              React.createElement(Input, { value: add.province_key, onChange: (e) => setAdd({ ...add, province_key: e.target.value }) })),
            React.createElement(Form.Item, { label: "重量上限(kg)" },
              React.createElement(InputNumber, { value: add.max_weight, onChange: (v) => setAdd({ ...add, max_weight: v }) })),
            React.createElement(Form.Item, { label: "金额下限(元)" },
              React.createElement(InputNumber, { value: add.min_amount, onChange: (v) => setAdd({ ...add, min_amount: v }) })),
            React.createElement(Form.Item, { label: "指定快递" },
              React.createElement(Select, { style: { width: "100%" }, value: add.carrier_id, onChange: (v) => setAdd({ ...add, carrier_id: v }) },
                carriers.map((c) => React.createElement(Option, { key: c.id, value: c.id }, c.name)))))) : null));
}

/* ============ 页面：系统设置 ============ */
function SystemPage() {
  const [users, setUsers] = useState([]);
  const [logs, setLogs] = useState([]);
  const [apis, setApis] = useState([]);
  useEffect(() => {
    api("/api/users").then(setUsers); api("/api/logs").then(setLogs); api("/api/openapi-spec").then(setApis);
  }, []);
  return React.createElement(Tabs, { items: [
    { key: "1", label: "组织与角色", children: React.createElement("div", null,
      React.createElement(Alert, { type: "warning", showIcon: true, style: { marginBottom: 12 },
        message: "多店铺场景下，权限至少要能按「店铺 / 仓库 / 品牌 / 法人主体」四层隔离，否则跨部门数据会串。" }),
      React.createElement(Table, { rowKey: "id", size: "small", pagination: false, dataSource: users,
        columns: [
          { title: "账号", dataIndex: "username" }, { title: "姓名", dataIndex: "name" },
          { title: "角色", dataIndex: "role_label", render: (v) => React.createElement(Tag, { color: "blue" }, v) },
          { title: "数据范围", render: () => React.createElement("span", { className: "dim" }, "按店铺分组授权") },
          { title: "状态", dataIndex: "enabled", render: (v) => React.createElement(Badge, { status: v ? "success" : "error", text: v ? "启用" : "停用" }) },
        ] })) },
    { key: "2", label: "操作日志", children: React.createElement(Timeline, { style: { marginTop: 12 },
      items: logs.map((l) => ({ children: React.createElement("div", null,
        React.createElement("span", { className: "dim mono" }, l.time), "  ",
        React.createElement(Tag, null, l.user), " ",
        React.createElement("b", null, l.action), " ",
        React.createElement("span", { className: "mono" }, l.target), " ",
        React.createElement("span", { className: "dim" }, l.detail)) })) }) },
    { key: "3", label: "开放 API", children: React.createElement("div", null,
      React.createElement(Alert, { type: "info", showIcon: true, style: { marginBottom: 12 },
        message: "开放平台决定能否对接自建 WMS、财务软件、BI 与第三方仓。采购时必须书面确认 QPS、日限额与版本兼容策略。" }),
      React.createElement(Table, { rowKey: "path", size: "small", pagination: false, dataSource: apis,
        columns: [
          { title: "接口", dataIndex: "path", width: 320, render: (v) => React.createElement("span", { className: "mono" }, v) },
          { title: "说明", dataIndex: "desc" },
          { title: "限流", dataIndex: "qps", width: 120, render: (v) => React.createElement(Tag, { color: "orange" }, v) },
        ] })) },
  ] });
}

/* ============ 主框架 ============ */
const BASE_PAGES = [
  { key: "dashboard", label: "经营概览", comp: Dashboard },
  { key: "shops", label: "多店铺管理", comp: Shops },
  { key: "products", label: "商品中心", comp: Products },
  { key: "inventory", label: "库存中心", comp: InventoryPage },
  { key: "orders", label: "订单履约", comp: Orders },
  { key: "print", label: "打印模板", comp: Templates },
  { key: "rules", label: "规则引擎", comp: Rules },
  { key: "system", label: "系统设置", comp: SystemPage },
];

function BaseApp() {
  const [cur, setCur] = useState((location.hash || "#dashboard").slice(1));
  useEffect(() => {
    const h = () => setCur((location.hash || "#dashboard").slice(1));
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, []);
  const page = PAGES.find((p) => p.key === cur) || PAGES[0];
  return React.createElement(Layout, { style: { minHeight: "100vh" } },
    React.createElement(Header, { className: "app-header" },
      React.createElement("div", { className: "logo" },
        React.createElement("span", { className: "cn" }, "塔奥"),
        React.createElement("span", { className: "en" }, "thalvior")),
      React.createElement("span", { className: "sub" }, "多平台 · 多店铺统一管理中枢"),
      React.createElement("div", { className: "header-right" },
        React.createElement(Tag, { color: "green" }, "12 店铺已授权"),
        React.createElement(Tag, { color: "blue" }, "8 平台"),
        React.createElement(Tag, { color: "purple" }, "3 仓"),
        React.createElement("span", { className: "user" }, "admin · 超级管理员"))),
    React.createElement(Layout, null,
      React.createElement(Sider, { width: 168, theme: "light", className: "app-sider" },
        React.createElement(Menu, { mode: "inline", selectedKeys: [page.key], style: { borderRight: 0 },
          onClick: (e) => { location.hash = "#" + e.key; },
          items: PAGES.map((p) => ({ key: p.key, label: p.label })) })),
      React.createElement(Content, { className: "app-content" },
        React.createElement(page.comp, { key: page.key }))));
}

