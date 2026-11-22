/* 扩展业务页面：采购供应链 / 仓储作业 / 售后 / 财务对账 / 报表中心 */

/* ============ 采购供应链 ============ */
function Purchase() {
  const [tab, setTab] = useState("1");
  const [sups, setSups] = useState([]);
  const [pos, setPos] = useState([]);
  const [rcs, setRcs] = useState([]);
  const [sug, setSug] = useState([]);
  const [detail, setDetail] = useState(null);
  const [whs, setWhs] = useState([]);
  const [prods, setProds] = useState([]);
  const [add, setAdd] = useState(null);

  const load = useCallback(() => {
    api("/api/suppliers").then(setSups);
    api("/api/purchase-orders").then(setPos);
    api("/api/receipts").then(setRcs);
    api("/api/supply-suggest").then(setSug);
    api("/api/warehouses").then(setWhs);
    api("/api/products").then(setProds);
  }, []);
  useEffect(() => { load(); }, [load]);

  const scols = [
    { title: "编码", dataIndex: "code", width: 100, render: (v) => React.createElement("span", { className: "mono" }, v) },
    { title: "供应商名称", dataIndex: "name", width: 200 },
    { title: "联系人", dataIndex: "contact", width: 90 },
    { title: "电话", dataIndex: "phone", width: 130 },
    { title: "账期", dataIndex: "pay_term", width: 100 },
    { title: "提前期", dataIndex: "lead_days", width: 80, render: (v) => v + " 天" },
    { title: "信用额度", dataIndex: "credit_limit", width: 110, render: money },
    { title: "评分", dataIndex: "score", width: 90, render: (v) => React.createElement(Tag, { color: v >= 90 ? "green" : "orange" }, v) },
    { title: "采购单", dataIndex: "po_count", width: 80 },
    { title: "采购金额", dataIndex: "po_amount", width: 110, render: money },
  ];
  const pcols = [
    { title: "采购单号", dataIndex: "po_no", width: 150, render: (v, r) => React.createElement("a", { onClick: () => api("/api/purchase-orders/" + r.id).then(setDetail) }, React.createElement("span", { className: "mono" }, v)) },
    { title: "供应商", dataIndex: "supplier", width: 180 },
    { title: "收货仓", dataIndex: "warehouse", width: 140 },
    { title: "状态", dataIndex: "status_label", width: 90, render: (v, r) => React.createElement(Tag, { color: { draft: "default", approved: "blue", partial: "orange", received: "green", cancelled: "red" }[r.status] }, v) },
    { title: "金额", dataIndex: "amount", width: 100, render: money },
    { title: "SKU数", dataIndex: "sku_count", width: 70 },
    { title: "到货进度", dataIndex: "progress", width: 150, render: (v, r) => React.createElement(Progress, { percent: v, size: "small", format: () => `${r.received}/${r.qty}` }) },
    { title: "预计到货", dataIndex: "expect_date", width: 110 },
    { title: "操作", width: 170, render: (_, r) => React.createElement(Space, { size: 4 },
      r.status !== "received" ? React.createElement(Button, { size: "small", type: "primary", onClick: async () => {
        const res = await post(`/api/purchase-orders/${r.id}/receive`);
        res.ok ? message.success(res.msg) : message.warning(res.msg); load();
      } }, "收货入库") : null,
      React.createElement(Button, { size: "small", onClick: async () => {
        const p = prods[0];
        if (!p) return;
        const res = await post(`/api/purchase-orders/${r.id}/return`, { product_id: p.id, qty: 5, reason: "来料不良" });
        res.ok ? message.success(res.msg) : message.warning(res.msg); load();
      } }, "退货")) },
  ];
  const rcols = [
    { title: "入库单号", dataIndex: "rc_no", width: 160, render: (v) => React.createElement("span", { className: "mono" }, v) },
    { title: "关联采购单", dataIndex: "po_no", width: 150 },
    { title: "收货仓", dataIndex: "warehouse", width: 150 },
    { title: "质检", dataIndex: "qc_pass", width: 80, render: (v) => React.createElement(Tag, { color: v ? "green" : "red" }, v ? "合格" : "不合格") },
    { title: "操作人", dataIndex: "operator", width: 90 },
    { title: "时间", dataIndex: "created_at", width: 110 },
  ];
  const gcols = [
    { title: "SKU", dataIndex: "sku", width: 120, render: (v) => React.createElement("span", { className: "mono" }, v) },
    { title: "商品", dataIndex: "name", width: 180 },
    { title: "仓库", dataIndex: "warehouse", width: 130 },
    { title: "可用", dataIndex: "available", width: 70, render: (v) => React.createElement("b", { style: { color: "#f5222d" } }, v) },
    { title: "安全库存", dataIndex: "safety", width: 90 },
    { title: "在途", dataIndex: "inbound", width: 70 },
    { title: "建议采购", dataIndex: "suggest", width: 90, render: (v) => React.createElement("b", null, v) },
    { title: "建议金额", dataIndex: "amount", width: 100, render: money },
    { title: "建议供应商", dataIndex: "supplier", width: 170 },
    { title: "到货周期", dataIndex: "lead_days", width: 90, render: (v) => v + " 天" },
    { title: "操作", width: 100, render: (_, r) => React.createElement(Button, { size: "small", type: "primary",
      onClick: () => setAdd({ supplier_id: r.supplier_id, warehouse_id: whs[0] && whs[0].id,
        items: [{ product_id: prods.find((p) => p.sku === r.sku) && prods.find((p) => p.sku === r.sku).id, qty: r.suggest }] }) }, "生成采购单") },
  ];

  return React.createElement("div", null,
    React.createElement(Alert, { type: "info", showIcon: true, style: { marginBottom: 12 },
      message: "采购供应链：供应商 → 采购单 → 到货质检入库 → 采购退货。入库后实物库存与批次同时增加。" }),
    React.createElement(Tabs, { activeKey: tab, onChange: setTab, items: [
      { key: "1", label: `供应商（${sups.length}）`, children: React.createElement(Table, { rowKey: "id", size: "small", scroll: { x: 1200 }, columns: scols, dataSource: sups, pagination: false }) },
      { key: "2", label: `采购单（${pos.length}）`, children: React.createElement("div", null,
        React.createElement(Space, { style: { marginBottom: 10 } },
          React.createElement(Button, { type: "primary", size: "small", onClick: () => setAdd({ supplier_id: sups[0] && sups[0].id, warehouse_id: whs[0] && whs[0].id, items: [] }) }, "+ 新建采购单")),
        React.createElement(Table, { rowKey: "id", size: "small", scroll: { x: 1250 }, columns: pcols, dataSource: pos, pagination: false })) },
      { key: "3", label: `入库单（${rcs.length}）`, children: React.createElement(Table, { rowKey: "id", size: "small", columns: rcols, dataSource: rcs, pagination: false }) },
      { key: "4", label: `智能补货建议（${sug.length}）`, children: React.createElement("div", null,
        React.createElement("div", { className: "dim", style: { marginBottom: 8 } }, "可用库存低于安全线或低于 30 件时触发，建议量 = max(安全库存×3, 50) − 可用 − 在途"),
        React.createElement(Table, { rowKey: "sku", size: "small", scroll: { x: 1250 }, columns: gcols, dataSource: sug, pagination: false })) },
    ] }),
    React.createElement(Drawer, { open: !!detail, title: detail ? `采购明细 ${detail.po_no}` : "", width: 620, onClose: () => setDetail(null) },
      detail ? React.createElement("div", null,
        React.createElement(Descriptions, { bordered: true, size: "small", column: 2 },
          React.createElement(Descriptions.Item, { label: "供应商" }, detail.supplier),
          React.createElement(Descriptions.Item, { label: "收货仓" }, detail.warehouse),
          React.createElement(Descriptions.Item, { label: "状态" }, detail.status),
          React.createElement(Descriptions.Item, { label: "金额" }, money(detail.amount)),
          React.createElement(Descriptions.Item, { label: "备注", span: 2 }, detail.remark || "-")),
        React.createElement(Divider, null, "采购明细"),
        React.createElement(Table, { size: "small", rowKey: "sku", pagination: false, dataSource: detail.items,
          columns: [
            { title: "SKU", dataIndex: "sku", render: (v) => React.createElement("span", { className: "mono" }, v) },
            { title: "商品", dataIndex: "name" },
            { title: "采购量", dataIndex: "qty" },
            { title: "已到货", dataIndex: "received_qty" },
            { title: "单价", dataIndex: "price", render: money },
            { title: "税率", dataIndex: "tax_rate", render: (v) => Math.round(v * 100) + "%" },
            { title: "小计", render: (_, r) => money(r.qty * r.price) },
          ] })) : null),
    React.createElement(Modal, { open: !!add, title: "新建采购单", width: 640, onCancel: () => setAdd(null),
      onOk: async () => {
        const items = (add.items || []).filter((i) => i.product_id && i.qty > 0);
        if (!items.length) { message.warning("请至少添加一个商品"); return; }
        const r = await post("/api/purchase-orders", add);
        r.ok ? message.success(`采购单 ${r.po_no} 已创建，金额 ${money(r.amount)}`) : message.warning("创建失败");
        setAdd(null); load();
      } },
      add ? React.createElement(Form, { layout: "vertical" },
        React.createElement(Form.Item, { label: "供应商" },
          React.createElement(Select, { style: { width: "100%" }, value: add.supplier_id || undefined, onChange: (v) => setAdd({ ...add, supplier_id: v }) },
            sups.map((s) => React.createElement(Option, { key: s.id, value: s.id }, `${s.name}（${s.pay_term}）`)))),
        React.createElement(Form.Item, { label: "收货仓" },
          React.createElement(Select, { style: { width: "100%" }, value: add.warehouse_id || undefined, onChange: (v) => setAdd({ ...add, warehouse_id: v }) },
            whs.map((w) => React.createElement(Option, { key: w.id, value: w.id }, w.name)))),
        React.createElement(Divider, null, "采购明细"),
        (add.items || []).map((it, idx) => React.createElement(Row, { gutter: 8, key: idx, style: { marginBottom: 8 } },
          React.createElement(Col, { span: 12 }, React.createElement(Select, { style: { width: "100%" }, placeholder: "选择商品",
            value: it.product_id || undefined,
            onChange: (v) => { const ns = [...add.items]; ns[idx].product_id = v; setAdd({ ...add, items: ns }); } },
            prods.map((p) => React.createElement(Option, { key: p.id, value: p.id }, `${p.sku} ${p.name}`)))),
          React.createElement(Col, { span: 6 }, React.createElement(InputNumber, { placeholder: "数量", style: { width: "100%" }, value: it.qty,
            onChange: (v) => { const ns = [...add.items]; ns[idx].qty = v; setAdd({ ...add, items: ns }); } })),
          React.createElement(Col, { span: 6 }, React.createElement(Button, { danger: true, onClick: () => setAdd({ ...add, items: add.items.filter((_, i) => i !== idx) }) }, "删除")))),
        React.createElement(Button, { size: "small", onClick: () => setAdd({ ...add, items: [...(add.items || []), { product_id: null, qty: 50 }] }) }, "+ 添加商品")) : null));
}

/* ============ 仓储作业 WMS ============ */
function Wms() {
  const [tab, setTab] = useState("1");
  const [locs, setLocs] = useState([]);
  const [bs, setBs] = useState([]);
  const [waves, setWaves] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [packs, setPacks] = useState([]);
  const [sts, setSts] = useState([]);
  const [stItems, setStItems] = useState(null);
  const [tfs, setTfs] = useState([]);
  const [whs, setWhs] = useState([]);
  const [orders, setOrders] = useState([]);
  const [sel, setSel] = useState([]);
  const [curWave, setCurWave] = useState(0);
  const [waveWh, setWaveWh] = useState(0);
  const [newSt, setNewSt] = useState(null);
  const [tf, setTf] = useState(null);
  const [prods, setProds] = useState([]);

  const load = useCallback(() => {
    api("/api/locations").then(setLocs);
    api("/api/batches").then(setBs);
    api("/api/waves").then(setWaves);
    api("/api/pack-checks").then(setPacks);
    api("/api/stocktakes").then(setSts);
    api("/api/transfers").then(setTfs);
    api("/api/warehouses").then(setWhs);
    api("/api/products").then(setProds);
    api("/api/orders?status=waiting").then(setOrders);
  }, []);
  useEffect(() => { load(); }, [load]);

  const lcols = [
    { title: "库位编码", dataIndex: "code", width: 120, render: (v) => React.createElement("span", { className: "mono" }, v) },
    { title: "仓库", dataIndex: "warehouse", width: 150 },
    { title: "库区", dataIndex: "zone", width: 90 },
    { title: "类型", dataIndex: "ltype", width: 100, render: (v) => React.createElement(Tag, { color: v === "拣货位" ? "blue" : "default" }, v) },
    { title: "状态", dataIndex: "enabled", width: 80, render: (v) => React.createElement(Tag, { color: v ? "green" : "default" }, v ? "启用" : "停用") },
  ];
  const bcols = [
    { title: "批次号", dataIndex: "batch_no", width: 150, render: (v) => React.createElement("span", { className: "mono" }, v) },
    { title: "仓库", dataIndex: "warehouse", width: 130 },
    { title: "SKU", dataIndex: "sku", width: 110, render: (v) => React.createElement("span", { className: "mono" }, v) },
    { title: "商品", dataIndex: "name", width: 170 },
    { title: "数量", dataIndex: "qty", width: 70 },
    { title: "成本价", dataIndex: "cost_price", width: 80, render: money },
    { title: "库位", dataIndex: "location_code", width: 100 },
    { title: "生产日期", dataIndex: "produced_at", width: 110 },
    { title: "到期日", dataIndex: "expire_at", width: 110 },
    { title: "剩余天数", dataIndex: "expire_days", width: 100,
      render: (v, r) => React.createElement("b", { style: { color: r.alert ? "#f5222d" : "#52c41a" } }, r.expire_days >= 999 ? "-" : v) },
    { title: "效期", dataIndex: "alert", width: 80, render: (v) => v ? React.createElement(Tag, { color: "red" }, "临期") : React.createElement(Tag, { color: "green" }, "正常") },
  ];
  const wcols = [
    { title: "波次号", dataIndex: "wave_no", width: 150, render: (v, r) => React.createElement("a", { onClick: () => { setCurWave(r.id); api("/api/waves/" + r.id + "/tasks").then(setTasks); setTab("3"); } }, React.createElement("span", { className: "mono" }, v)) },
    { title: "仓库", dataIndex: "warehouse", width: 140 },
    { title: "策略", dataIndex: "strategy", width: 90, render: (v) => React.createElement(Tag, { color: v === "摘果式" ? "blue" : "purple" }, v) },
    { title: "订单数", dataIndex: "order_count", width: 80 },
    { title: "SKU数", dataIndex: "sku_count", width: 80 },
    { title: "总件数", dataIndex: "qty_total", width: 80 },
    { title: "状态", dataIndex: "status", width: 90, render: (v) => React.createElement(Tag, { color: { created: "blue", picking: "orange", packed: "cyan", done: "green" }[v] }, v) },
    { title: "拣货人", dataIndex: "picker", width: 90 },
    { title: "操作", width: 110, render: (_, r) => React.createElement(Button, { size: "small", type: "primary",
      onClick: async () => { const res = await post(`/api/waves/${r.id}/pick`); message.success(res.msg); load(); } }, "执行拣货") },
  ];
  const tcols = [
    { title: "库位", dataIndex: "location_code", width: 110, render: (v) => React.createElement("span", { className: "mono" }, v) },
    { title: "订单号", dataIndex: "order_no", width: 170, render: (v) => React.createElement("span", { className: "mono" }, v) },
    { title: "SKU", dataIndex: "sku", width: 110, render: (v) => React.createElement("span", { className: "mono" }, v) },
    { title: "商品", dataIndex: "name", width: 170 },
    { title: "应拣", dataIndex: "qty", width: 70 },
    { title: "实拣", dataIndex: "picked_qty", width: 70 },
    { title: "状态", dataIndex: "status", width: 90, render: (v) => React.createElement(Tag, { color: { pending: "default", picked: "green", short: "red" }[v] }, { pending: "待拣", picked: "已拣", short: "缺货" }[v]) },
  ];
  const pcols = [
    { title: "订单号", dataIndex: "order_no", width: 170, render: (v) => React.createElement("span", { className: "mono" }, v) },
    { title: "实重(kg)", dataIndex: "weight_kg", width: 90 },
    { title: "运费", dataIndex: "freight", width: 90, render: money },
    { title: "快递", dataIndex: "carrier", width: 100 },
    { title: "运单号", dataIndex: "waybill_no", width: 150, render: (v) => React.createElement("span", { className: "mono" }, v) },
    { title: "结果", dataIndex: "result", width: 80, render: (v) => React.createElement(Tag, { color: v === "pass" ? "green" : "red" }, v) },
    { title: "验货员", dataIndex: "operator", width: 90 },
    { title: "时间", dataIndex: "checked_at", width: 110 },
  ];
  const stcols = [
    { title: "盘点单号", dataIndex: "st_no", width: 160, render: (v, r) => React.createElement("a", { onClick: () => api("/api/stocktakes/" + r.id + "/items").then(setStItems) }, React.createElement("span", { className: "mono" }, v)) },
    { title: "仓库", dataIndex: "warehouse", width: 140 },
    { title: "方式", dataIndex: "mode", width: 80, render: (v) => React.createElement(Tag, { color: v === "明盘" ? "blue" : "purple" }, v) },
    { title: "状态", dataIndex: "status", width: 90, render: (v) => React.createElement(Tag, { color: { draft: "default", counting: "orange", review: "cyan", done: "green" }[v] }, v) },
    { title: "SKU数", dataIndex: "sku_count", width: 80 },
    { title: "差异件数", dataIndex: "diff_qty", width: 90, render: (v, r) => r.status === "done" ? React.createElement("b", { style: { color: v === 0 ? "#52c41a" : "#f5222d" } }, v > 0 ? "+" + v : v) : "-" },
    { title: "损益金额", dataIndex: "diff_amount", width: 110, render: (v, r) => r.status === "done" ? money(v) : "-" },
    { title: "操作", width: 150, render: (_, r) => React.createElement(Space, { size: 4 },
      React.createElement(Button, { size: "small", onClick: () => api("/api/stocktakes/" + r.id + "/items").then(setStItems) }, "明细"),
      r.status !== "done" ? React.createElement(Button, { size: "small", type: "primary", onClick: async () => {
        const res = await post(`/api/stocktakes/${r.id}/submit`); message.success(res.msg); load();
      } }, "提交盘点") : null) },
  ];
  const tfcols = [
    { title: "调拨单号", dataIndex: "tf_no", width: 160, render: (v) => React.createElement("span", { className: "mono" }, v) },
    { title: "调出仓", dataIndex: "from", width: 140 },
    { title: "调入仓", dataIndex: "to", width: 140 },
    { title: "SKU", dataIndex: "sku", width: 110, render: (v) => React.createElement("span", { className: "mono" }, v) },
    { title: "商品", dataIndex: "name", width: 170 },
    { title: "数量", dataIndex: "qty", width: 70 },
    { title: "状态", dataIndex: "status", width: 90, render: (v) => React.createElement(Tag, { color: v === "received" ? "green" : "blue" }, v) },
    { title: "操作人", dataIndex: "operator", width: 90 },
  ];

  return React.createElement("div", null,
    React.createElement(Alert, { type: "info", showIcon: true, style: { marginBottom: 12 },
      message: "仓内作业：库位与批次效期 → 波次拣货（摘果式/播种式）→ 验货称重（按实重重算运费）→ 盘点（明盘/暗盘，差异自动生成损益）→ 库内调拨。" }),
    React.createElement(Tabs, { activeKey: tab, onChange: setTab, items: [
      { key: "1", label: `库位（${locs.length}）`, children: React.createElement(Table, { rowKey: "id", size: "small", columns: lcols, dataSource: locs, pagination: { pageSize: 12 } }) },
      { key: "2", label: `批次效期（${bs.length}）`, children: React.createElement("div", null,
        React.createElement("div", { className: "dim", style: { marginBottom: 8 } }, "按到期日升序，剩余不足 90 天标红；支持先进先出与临期预警"),
        React.createElement(Table, { rowKey: "id", size: "small", scroll: { x: 1250 }, columns: bcols, dataSource: bs, pagination: { pageSize: 12 } })) },
      { key: "3", label: `拣货波次（${waves.length}）`, children: React.createElement("div", null,
        React.createElement(Card, { size: "small", style: { marginBottom: 10 } },
          React.createElement(Space, { wrap: true },
            React.createElement("span", null, "发货仓："),
            React.createElement(Select, { style: { width: 200 }, value: waveWh || (whs[0] && whs[0].id) || undefined,
              onChange: (v) => { setWaveWh(v); setSel([]); } },
              whs.map((w) => React.createElement(Option, { key: w.id, value: w.id }, w.name))),
            React.createElement("span", null, "已选 ", React.createElement("b", null, sel.length), " 单"),
            React.createElement(Button, { type: "primary", size: "small", disabled: !sel.length, onClick: async () => {
              const r = await post("/api/waves", { warehouse_id: waveWh || whs[0].id, order_ids: sel, strategy: "摘果式" });
              r.ok ? message.success(r.msg) : message.warning(r.msg); setSel([]); load();
            } }, "生成波次")),
          React.createElement("div", { className: "dim", style: { marginTop: 6 } }, "波次把多笔订单聚合成一次拣货任务，按库位排序，减少仓内行走距离")),
        React.createElement(Table, { rowKey: "id", size: "small", scroll: { x: 1200 }, columns: wcols, dataSource: waves, pagination: false }),
        React.createElement(Divider, { plain: true }, "该仓待发货订单（勾选后生成波次）"),
        React.createElement(Table, { rowKey: "id", size: "small", pagination: { pageSize: 6 },
          rowSelection: { selectedRowKeys: sel, onChange: setSel },
          dataSource: orders.filter((o) => {
            const wid = waveWh || (whs[0] && whs[0].id);
            return !wid || o.warehouse_id === wid;
          }),
          columns: [
            { title: "订单号", dataIndex: "order_no", width: 170, render: (v) => React.createElement("span", { className: "mono" }, v) },
            { title: "店铺", dataIndex: "shop", width: 160 },
            { title: "收货地", render: (_, r) => `${r.province}${r.city}` },
            { title: "金额", dataIndex: "amount", render: money },
            { title: "发货仓", dataIndex: "warehouse" },
          ] })) },
      { key: "4", label: "波次拣货任务", children: React.createElement("div", null,
        React.createElement(Space, { style: { marginBottom: 10 } },
          React.createElement("span", null, "查看波次："),
          React.createElement(Select, { style: { width: 220 }, value: curWave || undefined, onChange: (v) => { setCurWave(v); api("/api/waves/" + v + "/tasks").then(setTasks); } },
            waves.map((w) => React.createElement(Option, { key: w.id, value: w.id }, `${w.wave_no}（${w.order_count}单/${w.qty_total}件）`))),
          React.createElement(Button, { size: "small", type: "primary", disabled: !curWave, onClick: async () => {
            const t0 = tasks[0];
            if (!t0) { message.warning("该波次暂无任务"); return; }
            const r = await post(`/api/waves/${curWave}/pack`, { order_id: t0.order_id, weight_kg: 1.2 });
            message.success(r.msg); load();
          } }, "验货称重（示例 1.2kg）")),
        React.createElement(Table, { rowKey: "id", size: "small", scroll: { x: 1000 }, columns: tcols, dataSource: tasks, pagination: { pageSize: 15 } })) },
      { key: "5", label: `验货打包（${packs.length}）`, children: React.createElement(Table, { rowKey: "id", size: "small", scroll: { x: 1000 }, columns: pcols, dataSource: packs, pagination: { pageSize: 12 } }) },
      { key: "6", label: `盘点（${sts.length}）`, children: React.createElement("div", null,
        React.createElement(Space, { style: { marginBottom: 10 } },
          React.createElement(Button, { type: "primary", size: "small", onClick: () => setNewSt({ warehouse_id: whs[0] && whs[0].id, mode: "明盘", limit: 12 }) }, "+ 新建盘点单")),
        React.createElement(Table, { rowKey: "id", size: "small", scroll: { x: 1100 }, columns: stcols, dataSource: sts, pagination: false })) },
      { key: "7", label: `调拨（${tfs.length}）`, children: React.createElement("div", null,
        React.createElement(Space, { style: { marginBottom: 10 } },
          React.createElement(Button, { type: "primary", size: "small", onClick: () => setTf({ from_warehouse_id: whs[0] && whs[0].id, to_warehouse_id: whs[1] && whs[1].id, product_id: prods[0] && prods[0].id, qty: 10 }) }, "+ 新建调拨")),
        React.createElement(Table, { rowKey: "id", size: "small", scroll: { x: 1150 }, columns: tfcols, dataSource: tfs, pagination: false })) },
    ] }),
    stItems ? React.createElement(Drawer, { open: true, title: `盘点明细 ${stItems.st_no}（${stItems.mode}）`, width: 720, onClose: () => setStItems(null),
      extra: stItems.status !== "done" ? React.createElement(Button, { type: "primary", size: "small", onClick: async () => {
        await post(`/api/stocktakes/${stItems.items[0] ? "" : ""}`, {}).catch(() => {});
        message.info("提示：在页面中修改实盘数后，点列表的「提交盘点」生成损益");
      } }, "说明") : null },
      React.createElement("div", null,
        React.createElement("div", { className: "dim", style: { marginBottom: 8 } },
          stItems.mode === "暗盘" ? "暗盘模式：实盘数不显示账面，避免盘点人作弊" : "明盘模式：显示账面数"),
        React.createElement(Table, { rowKey: "id", size: "small", pagination: false, dataSource: stItems.items,
          columns: [
            { title: "库位", dataIndex: "location_code", width: 100 },
            { title: "SKU", dataIndex: "sku", width: 110, render: (v) => React.createElement("span", { className: "mono" }, v) },
            { title: "商品", dataIndex: "name", width: 170 },
            { title: "账面", dataIndex: "book_qty", width: 80 },
            { title: "实盘", dataIndex: "real_qty", width: 110, render: (v, r) => stItems.status === "done" ? v :
              React.createElement(InputNumber, { size: "small", value: v, min: 0, onChange: (nv) => { r.real_qty = nv; setStItems({ ...stItems }); } }) },
            { title: "差异", dataIndex: "diff", width: 80, render: (v) => React.createElement("b", { style: { color: v === 0 ? "#52c41a" : (v > 0 ? "#1677ff" : "#f5222d") } }, v > 0 ? "+" + v : v) },
            { title: "成本", dataIndex: "cost_price", width: 80, render: money },
            { title: "损益", width: 100, render: (_, r) => money(r.diff * r.cost_price) },
          ] }))) : null,
    React.createElement(Modal, { open: !!newSt, title: "新建盘点单", onCancel: () => setNewSt(null),
      onOk: async () => { const r = await post("/api/stocktakes", newSt); r.ok ? message.success(r.msg) : message.warning(r.msg); setNewSt(null); load(); } },
      newSt ? React.createElement(Form, { layout: "vertical" },
        React.createElement(Form.Item, { label: "仓库" },
          React.createElement(Select, { style: { width: "100%" }, value: newSt.warehouse_id || undefined, onChange: (v) => setNewSt({ ...newSt, warehouse_id: v }) },
            whs.map((w) => React.createElement(Option, { key: w.id, value: w.id }, w.name)))),
        React.createElement(Form.Item, { label: "盘点方式" },
          React.createElement(Select, { style: { width: "100%" }, value: newSt.mode, onChange: (v) => setNewSt({ ...newSt, mode: v }) },
            React.createElement(Option, { value: "明盘" }, "明盘（显示账面数）"),
            React.createElement(Option, { value: "暗盘" }, "暗盘（隐藏账面数）"))),
        React.createElement(Form.Item, { label: "盘点 SKU 数" },
          React.createElement(InputNumber, { style: { width: "100%" }, value: newSt.limit, onChange: (v) => setNewSt({ ...newSt, limit: v }) }))) : null),
    React.createElement(Modal, { open: !!tf, title: "新建库内调拨", onCancel: () => setTf(null),
      onOk: async () => { const r = await post("/api/transfers", tf); r.ok ? message.success(r.msg) : message.warning(r.msg); setTf(null); load(); } },
      tf ? React.createElement(Form, { layout: "vertical" },
        React.createElement(Form.Item, { label: "调出仓" },
          React.createElement(Select, { style: { width: "100%" }, value: tf.from_warehouse_id || undefined, onChange: (v) => setTf({ ...tf, from_warehouse_id: v }) },
            whs.map((w) => React.createElement(Option, { key: w.id, value: w.id }, w.name)))),
        React.createElement(Form.Item, { label: "调入仓" },
          React.createElement(Select, { style: { width: "100%" }, value: tf.to_warehouse_id || undefined, onChange: (v) => setTf({ ...tf, to_warehouse_id: v }) },
            whs.map((w) => React.createElement(Option, { key: w.id, value: w.id }, w.name)))),
        React.createElement(Form.Item, { label: "商品" },
          React.createElement(Select, { style: { width: "100%" }, value: tf.product_id || undefined, onChange: (v) => setTf({ ...tf, product_id: v }) },
            prods.map((p) => React.createElement(Option, { key: p.id, value: p.id }, `${p.sku} ${p.name}`)))),
        React.createElement(Form.Item, { label: "数量" },
          React.createElement(InputNumber, { style: { width: "100%" }, value: tf.qty, onChange: (v) => setTf({ ...tf, qty: v }) }))) : null));
}

/* ============ 售后工单 ============ */
function AfterSales() {
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState(null);
  const [detail, setDetail] = useState(null);
  const [orders, setOrders] = useState([]);
  const [add, setAdd] = useState(null);
  const load = useCallback(() => {
    api("/api/after-sales").then(setRows);
    api("/api/after-sale-stats").then(setStats);
    api("/api/orders?status=shipped").then(setOrders);
  }, []);
  useEffect(() => { load(); }, [load]);

  const cols = [
    { title: "售后单号", dataIndex: "as_no", width: 160, render: (v, r) => React.createElement("a", { onClick: () => api("/api/after-sales/" + r.id).then(setDetail) }, React.createElement("span", { className: "mono" }, v)) },
    { title: "关联订单", dataIndex: "order_no", width: 170, render: (v) => React.createElement("span", { className: "mono" }, v) },
    { title: "店铺", dataIndex: "shop", width: 160 },
    { title: "买家", dataIndex: "buyer_nick", width: 110 },
    { title: "类型", dataIndex: "atype_label", width: 100, render: (v, r) => React.createElement(Tag, { color: { refund: "orange", return: "blue", exchange: "purple", resend: "cyan", repair: "default" }[r.atype] }, v) },
    { title: "原因", dataIndex: "reason", width: 130 },
    { title: "退款金额", dataIndex: "amount", width: 100, render: money },
    { title: "状态", dataIndex: "status_label", width: 90, render: (v, r) => React.createElement(Tag, { color: { pending: "orange", approved: "blue", processing: "cyan", done: "green", rejected: "red" }[r.status] }, v) },
    { title: "退回", width: 140, render: (_, r) => r.need_return
      ? React.createElement(Space, { size: 4 },
          React.createElement(Tag, { color: r.returned ? "green" : "default" }, r.returned ? "已退回" : "待退回"),
          r.restock ? React.createElement(Tag, { color: "blue" }, "已重新上架") : null)
      : React.createElement("span", { className: "dim" }, "无需退回") },
    { title: "处理人", dataIndex: "handler", width: 90 },
    { title: "操作", width: 250, render: (_, r) => React.createElement(Space, { size: 4, wrap: true },
      r.status === "pending" ? React.createElement(Button, { size: "small", type: "primary", onClick: async () => {
        const res = await post(`/api/after-sales/${r.id}/process?action=approve`); message.success(res.msg); load();
      } }, "同意") : null,
      r.status === "pending" ? React.createElement(Button, { size: "small", danger: true, onClick: async () => {
        const res = await post(`/api/after-sales/${r.id}/process?action=reject`); message.info(res.msg); load();
      } }, "拒绝") : null,
      (r.status === "approved" && r.need_return && !r.returned) ? React.createElement(Button, { size: "small", onClick: async () => {
        const res = await post(`/api/after-sales/${r.id}/process?action=return_received`); message.success(res.msg); load();
      } }, "退货入库") : null,
      ["approved", "processing"].indexOf(r.status) >= 0 ? React.createElement(Button, { size: "small", type: "primary", onClick: async () => {
        const res = await post(`/api/after-sales/${r.id}/process?action=done`); message.success(res.msg); load();
      } }, "完成退款") : null) },
  ];

  return React.createElement("div", null,
    stats ? React.createElement(Row, { gutter: 12, style: { marginBottom: 12 } },
      React.createElement(Col, { span: 4 }, React.createElement(Stat, { title: "售后单总数", value: stats.total })),
      React.createElement(Col, { span: 4 }, React.createElement(Stat, { title: "待审核", value: stats.pending, color: "#fa8c16" })),
      React.createElement(Col, { span: 4 }, React.createElement(Stat, { title: "已完成", value: stats.done, color: "#52c41a" })),
      React.createElement(Col, { span: 6 }, React.createElement(Stat, { title: "退款总额", value: stats.amount, prefix: "¥", color: "#f5222d" })),
      React.createElement(Col, { span: 6 }, React.createElement(Card, { size: "small", title: "按类型分布" },
        React.createElement("div", null, Object.entries(stats.by_type).map(([k, v], i) =>
          React.createElement("div", { key: i, style: { fontSize: 12, padding: "2px 0" } },
            React.createElement("span", { className: "dim" }, k), "：", React.createElement("b", null, v), " 单")))))) : null,
    React.createElement(Card, { size: "small", style: { marginBottom: 12 } },
      React.createElement(Space, null,
        React.createElement(Button, { type: "primary", onClick: () => setAdd({ order_id: orders[0] && orders[0].id, atype: "return", reason: "七天无理由" }) }, "+ 新建售后单"),
        React.createElement("span", { className: "dim" }, "退货入库时，质检为「良品」的商品自动重新上架，次品不计入库存"))),
    React.createElement(Table, { rowKey: "id", size: "small", scroll: { x: 1600 }, columns: cols, dataSource: rows, pagination: { pageSize: 12 } }),
    detail ? React.createElement(Drawer, { open: true, title: `售后明细 ${detail.as_no}`, width: 560, onClose: () => setDetail(null) },
      React.createElement(Table, { rowKey: "sku", size: "small", pagination: false, dataSource: detail.items,
        columns: [
          { title: "SKU", dataIndex: "sku", render: (v) => React.createElement("span", { className: "mono" }, v) },
          { title: "商品", dataIndex: "name" },
          { title: "数量", dataIndex: "qty" },
          { title: "单价", dataIndex: "price", render: money },
          { title: "质检", dataIndex: "quality_label", render: (v, r) => React.createElement(Tag, { color: r.quality === "good" ? "green" : "red" }, v) },
        ] })) : null,
    React.createElement(Modal, { open: !!add, title: "新建售后单", onCancel: () => setAdd(null),
      onOk: async () => { const r = await post("/api/after-sales", add); r.ok ? message.success(`售后单 ${r.as_no} 已创建`) : message.warning(r.msg); setAdd(null); load(); } },
      add ? React.createElement(Form, { layout: "vertical" },
        React.createElement(Form.Item, { label: "关联订单（已发货）" },
          React.createElement(Select, { style: { width: "100%" }, value: add.order_id || undefined, onChange: (v) => setAdd({ ...add, order_id: v }) },
            orders.map((o) => React.createElement(Option, { key: o.id, value: o.id }, `${o.order_no} · ${o.shop}`)))),
        React.createElement(Form.Item, { label: "售后类型" },
          React.createElement(Select, { style: { width: "100%" }, value: add.atype, onChange: (v) => setAdd({ ...add, atype: v }) },
            React.createElement(Option, { value: "refund" }, "仅退款"),
            React.createElement(Option, { value: "return" }, "退货退款"),
            React.createElement(Option, { value: "exchange" }, "换货"),
            React.createElement(Option, { value: "resend" }, "补发"),
            React.createElement(Option, { value: "repair" }, "维修"))),
        React.createElement(Form.Item, { label: "原因" },
          React.createElement(Input, { value: add.reason, onChange: (e) => setAdd({ ...add, reason: e.target.value }) }))) : null));
}

/* ============ 财务对账 ============ */
function Finance() {
  const [tab, setTab] = useState("1");
  const [bills, setBills] = useState([]);
  const [fees, setFees] = useState([]);
  const [apar, setApar] = useState([]);
  const [profit, setProfit] = useState(null);
  const [records, setRecords] = useState([]);
  const [shops, setShops] = useState([]);
  const load = useCallback(() => {
    api("/api/bills").then(setBills);
    api("/api/ap-ar").then(setApar);
    api("/api/profit").then(setProfit);
    api("/api/profit/records").then(setRecords);
    api("/api/shops").then(setShops);
  }, []);
  useEffect(() => { load(); }, [load]);

  const bcols = [
    { title: "账单号", dataIndex: "bill_no", width: 180, render: (v, r) => React.createElement("a", { onClick: () => api("/api/bills/" + r.id + "/fees").then(setFees) }, React.createElement("span", { className: "mono" }, v)) },
    { title: "店铺", dataIndex: "shop", width: 170 },
    { title: "平台", dataIndex: "platform", width: 80, render: (v) => React.createElement(Tag, { color: "blue" }, v) },
    { title: "账期", dataIndex: "period", width: 90 },
    { title: "订单金额", dataIndex: "order_amount", width: 100, render: money },
    { title: "佣金", dataIndex: "commission", width: 80, render: money },
    { title: "服务费", dataIndex: "service_fee", width: 80, render: money },
    { title: "广告费", dataIndex: "ad_fee", width: 80, render: money },
    { title: "退款", dataIndex: "refund_amount", width: 80, render: money },
    { title: "运费", dataIndex: "freight_fee", width: 70, render: money },
    { title: "应结算", dataIndex: "settle_amount", width: 100, render: (v) => React.createElement("b", { style: { color: "#52c41a" } }, money(v)) },
    { title: "费率", dataIndex: "fee_rate", width: 80, render: (v) => (v * 100).toFixed(2) + "%" },
    { title: "状态", dataIndex: "status", width: 90, render: (v) => React.createElement(Tag, { color: { pending: "orange", reconciled: "blue", settled: "green" }[v] }, { pending: "待对账", reconciled: "已对账", settled: "已结算" }[v]) },
    { title: "操作", width: 90, render: (_, r) => React.createElement(Button, { size: "small", onClick: async () => {
      await post(`/api/bills/${r.id}/reconcile`); message.success("已对账"); load();
    } }, "对账") },
  ];
  const acols = [
    { title: "方向", dataIndex: "direction_label", width: 80, render: (v, r) => React.createElement(Tag, { color: r.direction === "ar" ? "green" : "orange" }, v) },
    { title: "往来单位类型", dataIndex: "partner_type_label", width: 110 },
    { title: "往来单位", dataIndex: "partner_name", width: 190 },
    { title: "关联单号", dataIndex: "ref_no", width: 170, render: (v) => React.createElement("span", { className: "mono" }, v) },
    { title: "金额", dataIndex: "amount", width: 100, render: money },
    { title: "已结", dataIndex: "settled_amount", width: 90, render: money },
    { title: "未结", dataIndex: "unsettled", width: 100, render: (v) => React.createElement("b", { style: { color: v > 0 ? "#f5222d" : "#52c41a" } }, money(v)) },
    { title: "状态", dataIndex: "status_label", width: 80, render: (v, r) => React.createElement(Tag, { color: { open: "red", partial: "orange", closed: "green" }[r.status] }, v) },
    { title: "到期日", dataIndex: "due_date", width: 110 },
  ];
  const rcols = [
    { title: "订单号", dataIndex: "order_no", width: 170, render: (v) => React.createElement("span", { className: "mono" }, v) },
    { title: "店铺", dataIndex: "shop", width: 170 },
    { title: "收入", dataIndex: "revenue", width: 90, render: money },
    { title: "商品成本", dataIndex: "goods_cost", width: 90, render: money },
    { title: "运费", dataIndex: "freight_cost", width: 70, render: money },
    { title: "平台费", dataIndex: "platform_fee", width: 80, render: money },
    { title: "广告分摊", dataIndex: "ad_fee", width: 90, render: money },
    { title: "包材", dataIndex: "pack_cost", width: 70, render: money },
    { title: "毛利", dataIndex: "gross_profit", width: 90, render: (v) => React.createElement("b", { style: { color: v >= 0 ? "#1677ff" : "#f5222d" } }, money(v)) },
    { title: "净利", dataIndex: "net_profit", width: 90, render: (v) => React.createElement("b", { style: { color: v >= 0 ? "#52c41a" : "#f5222d" } }, money(v)) },
    { title: "净利率", dataIndex: "margin", width: 80, render: (v) => React.createElement("b", { style: { color: v >= 0.2 ? "#52c41a" : "#fa8c16" } }, (v * 100).toFixed(1) + "%") },
  ];

  const profitOpt = profit ? {
    tooltip: { trigger: "axis" },
    legend: { data: ["收入", "净利"], bottom: 0 },
    grid: { left: 60, right: 30, top: 20, bottom: 40 },
    xAxis: { type: "category", data: profit.rows.map((r) => r.shop.slice(0, 6)), axisLabel: { fontSize: 10, interval: 0, rotate: 30 } },
    yAxis: { type: "value" },
    series: [
      { name: "收入", type: "bar", data: profit.rows.map((r) => r.revenue), itemStyle: { color: "#91caff" } },
      { name: "净利", type: "bar", data: profit.rows.map((r) => r.net), itemStyle: { color: "#52c41a" } },
    ],
  } : null;

  return React.createElement("div", null,
    React.createElement(Alert, { type: "warning", showIcon: true, style: { marginBottom: 12 },
      message: "利润口径必须统一：净利 = 收入 − 商品成本 − 运费 − 平台佣金/服务费 − 广告分摊 − 包材。只算毛利会把高流量低利润的店铺误判为优质店铺。" }),
    React.createElement(Tabs, { activeKey: tab, onChange: setTab, items: [
      { key: "1", label: `平台账单（${bills.length}）`, children: React.createElement("div", null,
        React.createElement(Space, { style: { marginBottom: 10 }, wrap: true },
          React.createElement(Select, { style: { width: 220 }, placeholder: "选择店铺生成账单",
            onChange: async (v) => { const r = await post(`/api/bills/generate?shop_id=${v}`); r.ok ? message.success(r.msg) : message.warning(r.msg); load(); } },
            shops.map((s) => React.createElement(Option, { key: s.id, value: s.id }, s.name)))),
        React.createElement(Table, { rowKey: "id", size: "small", scroll: { x: 1450 }, columns: bcols, dataSource: bills, pagination: false }),
        fees.length ? React.createElement(Card, { size: "small", title: "账单费用明细", style: { marginTop: 12 } },
          React.createElement(Table, { rowKey: "id", size: "small", pagination: false, dataSource: fees,
            columns: [
              { title: "费用类型", dataIndex: "fee_type" },
              { title: "金额", dataIndex: "amount", render: money },
              { title: "说明", dataIndex: "remark" },
            ] })) : null) },
      { key: "2", label: `应收应付（${apar.length}）`, children: React.createElement(Table, { rowKey: "id", size: "small", scroll: { x: 1150 }, columns: acols, dataSource: apar, pagination: { pageSize: 12 } }) },
      { key: "3", label: "利润核算", children: React.createElement("div", null,
        React.createElement(Space, { style: { marginBottom: 10 } },
          React.createElement(Button, { type: "primary", size: "small", onClick: async () => {
            const r = await post("/api/profit/calc"); message.success(r.msg); load();
          } }, "重新核算订单利润")),
        profit ? React.createElement("div", null,
          React.createElement(Row, { gutter: 12, style: { marginBottom: 12 } },
            React.createElement(Col, { span: 6 }, React.createElement(Stat, { title: "核算店铺数", value: profit.count })),
            React.createElement(Col, { span: 6 }, React.createElement(Stat, { title: "总收入", value: profit.total_revenue, prefix: "¥", color: "#1677ff" })),
            React.createElement(Col, { span: 6 }, React.createElement(Stat, { title: "总净利", value: profit.total_net, prefix: "¥", color: "#52c41a" })),
            React.createElement(Col, { span: 6 }, React.createElement(Stat, { title: "综合净利率", value: (profit.total_margin * 100).toFixed(1), suffix: "%", color: "#722ed1" }))),
          React.createElement(Card, { size: "small", title: "店铺收入 vs 净利", style: { marginBottom: 12 } },
            React.createElement(EChart, { option: profitOpt, height: 280 })),
          React.createElement(Table, { rowKey: "shop", size: "small", scroll: { x: 1100 }, pagination: false,
            dataSource: profit.rows,
            columns: [
              { title: "店铺", dataIndex: "shop", width: 170 },
              { title: "平台", dataIndex: "platform", width: 80, render: (v) => React.createElement(Tag, { color: "blue" }, v) },
              { title: "订单数", dataIndex: "orders", width: 80 },
              { title: "收入", dataIndex: "revenue", width: 100, render: money },
              { title: "商品成本", dataIndex: "goods_cost", width: 100, render: money },
              { title: "平台费", dataIndex: "platform_fee", width: 90, render: money },
              { title: "广告费", dataIndex: "ad_fee", width: 90, render: money },
              { title: "毛利", dataIndex: "gross", width: 90, render: money },
              { title: "净利", dataIndex: "net", width: 90, render: (v) => React.createElement("b", { style: { color: v >= 0 ? "#52c41a" : "#f5222d" } }, money(v)) },
              { title: "净利率", dataIndex: "margin", width: 90, render: (v) => React.createElement("b", { style: { color: v >= 0.2 ? "#52c41a" : "#fa8c16" } }, (v * 100).toFixed(1) + "%") },
            ] })) : React.createElement(Empty, { description: "暂无利润数据，点击上方按钮核算" })) },
      { key: "4", label: `订单利润明细（${records.length}）`, children: React.createElement(Table, { rowKey: "id", size: "small", scroll: { x: 1250 }, columns: rcols, dataSource: records, pagination: { pageSize: 12 } }) },
    ] }));
}

/* ============ 报表中心 ============ */
function Reports() {
  const [tab, setTab] = useState("1");
  const [sales, setSales] = useState(null);
  const [inv, setInv] = useState(null);
  const [ful, setFul] = useState(null);
  const [daily, setDaily] = useState(null);
  useEffect(() => {
    api("/api/reports/sales").then(setSales);
    api("/api/reports/inventory").then(setInv);
    api("/api/reports/fulfillment").then(setFul);
    api("/api/reports/daily").then(setDaily);
  }, []);

  const platOpt = sales ? {
    tooltip: { trigger: "item" },
    legend: { bottom: 0 },
    series: [{ type: "pie", radius: ["40%", "66%"], data: sales.by_platform.map((r) => ({ name: r.name, value: r.amount })) }],
  } : null;
  const catOpt = sales ? {
    tooltip: { trigger: "axis" },
    grid: { left: 60, right: 30, top: 20, bottom: 30 },
    xAxis: { type: "category", data: sales.by_category.map((r) => r.name) },
    yAxis: { type: "value" },
    series: [{ type: "bar", data: sales.by_category.map((r) => r.amount), itemStyle: { color: "#1677ff" } },
             { type: "line", data: sales.by_category.map((r) => r.qty), yAxisIndex: 0 }],
  } : null;
  const stOpt = inv ? {
    tooltip: { trigger: "item" },
    legend: { bottom: 0 },
    series: [{ type: "pie", radius: ["40%", "66%"],
      data: [
        { name: "正常", value: inv.rows.filter((r) => r.status === "正常").length },
        { name: "缺货", value: inv.short },
        { name: "呆滞", value: inv.slow },
      ],
      color: ["#52c41a", "#f5222d", "#faad14"] }],
  } : null;

  return React.createElement("div", null,
    React.createElement(Tabs, { activeKey: tab, onChange: setTab, items: [
      { key: "1", label: "销售报表", children: sales ? React.createElement("div", null,
        React.createElement(Row, { gutter: 12 },
          React.createElement(Col, { span: 10 }, React.createElement(Card, { size: "small", title: "平台销售额占比" }, React.createElement(EChart, { option: platOpt, height: 260 }))),
          React.createElement(Col, { span: 14 }, React.createElement(Card, { size: "small", title: "品类销售额与销量" }, React.createElement(EChart, { option: catOpt, height: 260 })))),
        React.createElement(Card, { size: "small", title: "SKU 销售排行 TOP15", style: { marginTop: 12 } },
          React.createElement(Table, { rowKey: "sku", size: "small", pagination: false, dataSource: sales.sku_top,
            columns: [
              { title: "SKU", dataIndex: "sku", width: 130, render: (v) => React.createElement("span", { className: "mono" }, v) },
              { title: "商品", dataIndex: "name", width: 220 },
              { title: "销量", dataIndex: "qty", width: 90 },
              { title: "销售额", dataIndex: "amount", width: 110, render: money },
            ] }))) : React.createElement("div", { className: "loading" }, "加载中…") },
      { key: "2", label: "库存报表", children: inv ? React.createElement("div", null,
        React.createElement(Row, { gutter: 12, style: { marginBottom: 12 } },
          React.createElement(Col, { span: 6 }, React.createElement(Stat, { title: "库存总值", value: inv.total_value, prefix: "¥", color: "#1677ff" })),
          React.createElement(Col, { span: 6 }, React.createElement(Stat, { title: "呆滞 SKU", value: inv.slow, color: "#faad14" })),
          React.createElement(Col, { span: 6 }, React.createElement(Stat, { title: "缺货 SKU", value: inv.short, color: "#f5222d" })),
          React.createElement(Col, { span: 6 }, React.createElement(Card, { size: "small", title: "库存健康度" }, React.createElement(EChart, { option: stOpt, height: 150 })))),
        React.createElement(Table, { rowKey: "sku", size: "small", scroll: { x: 1150 }, pagination: { pageSize: 12 }, dataSource: inv.rows,
          columns: [
            { title: "SKU", dataIndex: "sku", width: 120, render: (v) => React.createElement("span", { className: "mono" }, v) },
            { title: "商品", dataIndex: "name", width: 190 },
            { title: "分类", dataIndex: "category", width: 90 },
            { title: "实物", dataIndex: "on_hand", width: 70 },
            { title: "可用", dataIndex: "available", width: 70 },
            { title: "锁定", dataIndex: "locked", width: 70 },
            { title: "累计销量", dataIndex: "sold", width: 90 },
            { title: "周转率", dataIndex: "turnover", width: 80 },
            { title: "可售天数", dataIndex: "cover_days", width: 90, render: (v) => v >= 999 ? "∞" : v },
            { title: "库存金额", dataIndex: "value", width: 100, render: money },
            { title: "状态", dataIndex: "status", width: 80, render: (v) => React.createElement(Tag, { color: { "正常": "green", "缺货": "red", "呆滞": "orange" }[v] }, v) },
          ] })) : React.createElement("div", { className: "loading" }, "加载中…") },
      { key: "3", label: "履约效率", children: ful ? React.createElement("div", null,
        React.createElement(Row, { gutter: 12, style: { marginBottom: 12 } },
          React.createElement(Col, { span: 6 }, React.createElement(Stat, { title: "已发货订单", value: ful.shipped_count, color: "#52c41a" })),
          React.createElement(Col, { span: 6 }, React.createElement(Stat, { title: "平均审单时长", value: ful.avg_audit_min, suffix: "分钟", color: "#1677ff" })),
          React.createElement(Col, { span: 6 }, React.createElement(Stat, { title: "平均发货时长", value: ful.avg_ship_hour, suffix: "小时", color: "#722ed1" })),
          React.createElement(Col, { span: 6 }, React.createElement(Stat, { title: "拦截率", value: (ful.intercept_rate * 100).toFixed(1), suffix: "%", color: "#f5222d" }))),
        React.createElement(Row, { gutter: 12 },
          React.createElement(Col, { span: 12 }, React.createElement(Card, { size: "small", title: "订单状态分布" },
            React.createElement(Table, { rowKey: "k", size: "small", pagination: false,
              dataSource: Object.entries(ful.by_status).map(([k, v]) => ({ k, v })),
              columns: [
                { title: "状态", dataIndex: "k", render: (v) => React.createElement(Tag, { color: STATUS_COLOR[v] }, (STATUS_LABEL_C[v] || v)) },
                { title: "订单数", dataIndex: "v" },
                { title: "占比", render: (_, r) => ((r.v / ful.total_orders) * 100).toFixed(1) + "%" },
              ] }))),
          React.createElement(Col, { span: 12 }, React.createElement(Card, { size: "small", title: "仓内作业" },
            React.createElement(Descriptions, { bordered: true, size: "small", column: 1 },
              React.createElement(Descriptions.Item, { label: "拣货波次总数" }, ful.wave_count),
              React.createElement(Descriptions.Item, { label: "已完成波次" }, ful.wave_done),
              React.createElement(Descriptions.Item, { label: "盘点单数量" }, ful.stocktake_count),
              React.createElement(Descriptions.Item, { label: "订单总量" }, ful.total_orders)))))) : React.createElement("div", { className: "loading" }, "加载中…") },
      { key: "4", label: "经营日报", children: daily ? React.createElement("div", null,
        React.createElement(Row, { gutter: 12 },
          React.createElement(Col, { span: 8 }, React.createElement(Card, { size: "small", title: "今日订单" },
            React.createElement(Statistic, { value: daily.today.orders, valueStyle: { fontSize: 30, color: "#1677ff" } }),
            React.createElement("div", { className: "dim" }, "较昨日 ", React.createElement("b", { style: { color: daily.delta_orders >= 0 ? "#52c41a" : "#f5222d" } }, daily.delta_orders >= 0 ? "+" + daily.delta_orders : daily.delta_orders)))),
          React.createElement(Col, { span: 8 }, React.createElement(Card, { size: "small", title: "今日销售额" },
            React.createElement(Statistic, { value: daily.today.amount, prefix: "¥", valueStyle: { fontSize: 30, color: "#52c41a" } }),
            React.createElement("div", { className: "dim" }, "较昨日 ", React.createElement("b", { style: { color: daily.delta_amount >= 0 ? "#52c41a" : "#f5222d" } }, (daily.delta_amount >= 0 ? "+" : "") + daily.delta_amount.toFixed(2))))),
          React.createElement(Col, { span: 8 }, React.createElement(Card, { size: "small", title: "今日已发货" },
            React.createElement(Statistic, { value: daily.today.shipped, valueStyle: { fontSize: 30, color: "#722ed1" } }),
            React.createElement("div", { className: "dim" }, "昨日发货 ", daily.yesterday.shipped)))),
        React.createElement(Alert, { type: "info", showIcon: true, style: { marginTop: 12 },
          message: "经营日报应支持定时推送到企微/钉钉/邮件，并可保存为团队模板；2.0 版本将补齐周报、月报与自定义报表配置。" })) : React.createElement("div", { className: "loading" }, "加载中…") },
    ] }));
}

const STATUS_LABEL_C = {
  pending: "待审单", auditing: "挂起待处理", waiting: "待发货",
  shipped: "已发货", intercepted: "已拦截", cancelled: "已取消", merged: "已合并",
};

/* ============ 重新组装页面与路由 ============ */
const PAGES = BASE_PAGES.concat([
  { key: "purchase", label: "采购供应链", comp: Purchase },
  { key: "wms", label: "仓储作业", comp: Wms },
  { key: "aftersale", label: "售后工单", comp: AfterSales },
  { key: "finance", label: "财务对账", comp: Finance },
  { key: "reports", label: "报表中心", comp: Reports },
]);

function App() {
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

ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));
