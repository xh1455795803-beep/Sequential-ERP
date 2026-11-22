/* 塔奥 thalvior · 多店铺电商 ERP 前端 (React 18 + Ant Design 5) */
const {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo
} = React;
const {
  Layout,
  Menu,
  Table,
  Card,
  Statistic,
  Button,
  Modal,
  Form,
  Input,
  Select,
  Tag,
  Tabs,
  Row,
  Col,
  Space,
  Drawer,
  Switch,
  message,
  notification,
  Descriptions,
  Badge,
  Progress,
  Tooltip,
  Popconfirm,
  Divider,
  Alert,
  Empty,
  InputNumber,
  Checkbox,
  List,
  Steps,
  Timeline
} = antd;
const {
  Header,
  Sider,
  Content
} = Layout;
const {
  Option
} = Select;
const {
  TextArea
} = Input;
const API = "";
async function api(path, opts) {
  const r = await fetch(API + path, opts ? {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(opts.headers || {})
    }
  } : {});
  if (!r.ok) {
    const t = await r.text();
    throw new Error(t || r.statusText);
  }
  return r.json();
}
const post = (p, b) => api(p, {
  method: "POST",
  body: JSON.stringify(b || {})
});
const put = (p, b) => api(p, {
  method: "PUT",
  body: JSON.stringify(b || {})
});
const del = p => api(p, {
  method: "DELETE"
});
const STATUS_COLOR = {
  pending: "blue",
  auditing: "orange",
  waiting: "cyan",
  shipped: "green",
  intercepted: "red",
  cancelled: "default",
  merged: "purple"
};
const money = v => "¥" + Number(v || 0).toLocaleString("zh-CN", {
  minimumFractionDigits: 2
});

/* ============ 通用组件 ============ */
function EChart({
  option,
  height = 260
}) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    const c = echarts.init(ref.current);
    c.setOption(option);
    const h = () => c.resize();
    window.addEventListener("resize", h);
    return () => {
      window.removeEventListener("resize", h);
      c.dispose();
    };
  }, [JSON.stringify(option)]);
  return React.createElement("div", {
    ref,
    style: {
      width: "100%",
      height
    }
  });
}
function Stat({
  title,
  value,
  color,
  suffix,
  prefix
}) {
  return React.createElement(Card, {
    size: "small",
    className: "stat-card"
  }, React.createElement(Statistic, {
    title,
    value,
    suffix,
    prefix,
    valueStyle: {
      color: color || "#1677ff",
      fontSize: 22,
      fontWeight: 600
    }
  }));
}

/* ============ 页面：经营概览 ============ */
function Dashboard() {
  const [d, setD] = useState(null);
  const load = () => api("/api/dashboard").then(setD);
  useEffect(() => {
    load();
  }, []);
  if (!d) return React.createElement("div", {
    className: "loading"
  }, "加载中…");
  const trendOpt = {
    tooltip: {
      trigger: "axis"
    },
    legend: {
      data: ["订单量", "销售额"],
      bottom: 0
    },
    grid: {
      left: 50,
      right: 50,
      top: 30,
      bottom: 40
    },
    xAxis: {
      type: "category",
      data: d.trend.map(t => t.date)
    },
    yAxis: [{
      type: "value",
      name: "单量"
    }, {
      type: "value",
      name: "金额"
    }],
    series: [{
      name: "订单量",
      type: "line",
      smooth: true,
      areaStyle: {},
      data: d.trend.map(t => t.orders),
      itemStyle: {
        color: "#1677ff"
      }
    }, {
      name: "销售额",
      type: "bar",
      yAxisIndex: 1,
      data: d.trend.map(t => t.amount),
      itemStyle: {
        color: "#91caff"
      }
    }]
  };
  const rankOpt = {
    tooltip: {
      trigger: "axis"
    },
    grid: {
      left: 130,
      right: 40,
      top: 10,
      bottom: 20
    },
    xAxis: {
      type: "value"
    },
    yAxis: {
      type: "category",
      data: d.shop_rank.map(s => s.shop).reverse(),
      axisLabel: {
        fontSize: 11
      }
    },
    series: [{
      type: "bar",
      data: d.shop_rank.map(s => s.amount).reverse(),
      itemStyle: {
        color: "#52c41a"
      }
    }]
  };
  const whOpt = {
    tooltip: {
      trigger: "item"
    },
    legend: {
      bottom: 0
    },
    series: [{
      type: "pie",
      radius: ["42%", "68%"],
      data: d.wh_dist.map(w => ({
        name: w.name,
        value: w.available
      }))
    }]
  };
  return React.createElement("div", null, React.createElement(Row, {
    gutter: 12
  }, React.createElement(Col, {
    span: 6
  }, React.createElement(Stat, {
    title: "在管店铺 / 平台",
    value: `${d.shops} / ${d.platforms}`
  })), React.createElement(Col, {
    span: 6
  }, React.createElement(Stat, {
    title: "统一商品池 SKU",
    value: d.skus,
    suffix: "个",
    color: "#722ed1"
  })), React.createElement(Col, {
    span: 6
  }, React.createElement(Stat, {
    title: "平台商品映射",
    value: d.listings,
    suffix: "条",
    color: "#13c2c2"
  })), React.createElement(Col, {
    span: 6
  }, React.createElement(Stat, {
    title: "累计 GMV",
    value: d.gmv,
    prefix: "¥",
    color: "#52c41a"
  }))), React.createElement(Row, {
    gutter: 12,
    style: {
      marginTop: 12
    }
  }, React.createElement(Col, {
    span: 4
  }, React.createElement(Stat, {
    title: "今日订单",
    value: d.today_orders,
    color: "#1677ff"
  })), React.createElement(Col, {
    span: 4
  }, React.createElement(Stat, {
    title: "待审单",
    value: d.pending,
    color: "#fa8c16"
  })), React.createElement(Col, {
    span: 4
  }, React.createElement(Stat, {
    title: "挂起待处理",
    value: d.auditing,
    color: "#faad14"
  })), React.createElement(Col, {
    span: 4
  }, React.createElement(Stat, {
    title: "待发货",
    value: d.waiting,
    color: "#13c2c2"
  })), React.createElement(Col, {
    span: 4
  }, React.createElement(Stat, {
    title: "已发货",
    value: d.shipped,
    color: "#52c41a"
  })), React.createElement(Col, {
    span: 4
  }, React.createElement(Stat, {
    title: "已拦截",
    value: d.intercepted,
    color: "#f5222d"
  }))), React.createElement(Row, {
    gutter: 12,
    style: {
      marginTop: 12
    }
  }, React.createElement(Col, {
    span: 14
  }, React.createElement(Card, {
    title: "近 7 日订单与销售额趋势",
    size: "small"
  }, React.createElement(EChart, {
    option: trendOpt
  }))), React.createElement(Col, {
    span: 10
  }, React.createElement(Card, {
    title: "仓库可用库存分布",
    size: "small"
  }, React.createElement(EChart, {
    option: whOpt,
    height: 260
  })))), React.createElement(Row, {
    gutter: 12,
    style: {
      marginTop: 12
    }
  }, React.createElement(Col, {
    span: 14
  }, React.createElement(Card, {
    title: "店铺销售额排行（TOP 10）",
    size: "small"
  }, React.createElement(EChart, {
    option: rankOpt,
    height: 300
  }))), React.createElement(Col, {
    span: 10
  }, React.createElement(Card, {
    title: "库存预警（可用 < 安全库存）",
    size: "small",
    extra: React.createElement(Tag, {
      color: "red"
    }, d.alerts.length + " 项")
  }, React.createElement("div", {
    className: "scroll-box"
  }, d.alerts.length ? d.alerts.map((a, i) => React.createElement("div", {
    key: i,
    className: "alert-row"
  }, React.createElement(Tag, {
    color: "red"
  }, "缺货风险"), React.createElement("span", {
    className: "mono"
  }, a.sku), React.createElement("span", null, a.name), React.createElement("span", {
    className: "dim"
  }, a.warehouse), React.createElement("b", {
    style: {
      color: "#f5222d"
    }
  }, `可用 ${a.available} / 安全 ${a.safety}`))) : React.createElement(Empty, {
    description: "暂无预警"
  }))))));
}

/* ============ 页面：多店铺管理 ============ */
function Shops() {
  const [rows, setRows] = useState([]);
  const [plats, setPlats] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    code: "",
    name: "",
    platform_id: "",
    entity: "",
    group: "默认分组"
  });
  const load = () => {
    api("/api/shops").then(setRows);
    api("/api/platforms").then(setPlats);
  };
  useEffect(() => {
    load();
  }, []);
  const act = async (id, fn, msg_ok) => {
    try {
      await fn();
      message.success(msg_ok);
      load();
    } catch (e) {
      message.error(e.message);
    }
  };
  const groups = [...new Set(rows.map(r => r.group))];
  const cols = [{
    title: "店铺编码",
    dataIndex: "code",
    width: 110,
    render: v => React.createElement("span", {
      className: "mono"
    }, v)
  }, {
    title: "店铺名称",
    dataIndex: "name",
    width: 200
  }, {
    title: "平台",
    dataIndex: "platform",
    width: 90,
    render: v => React.createElement(Tag, {
      color: "blue"
    }, v)
  }, {
    title: "店铺分组",
    dataIndex: "group",
    width: 100
  }, {
    title: "经营主体",
    dataIndex: "entity",
    width: 220
  }, {
    title: "授权",
    dataIndex: "auth_status",
    width: 100,
    render: v => v === "authorized" ? React.createElement(Badge, {
      status: "success",
      text: "已授权"
    }) : React.createElement(Badge, {
      status: "error",
      text: "未授权"
    })
  }, {
    title: "授权日期",
    dataIndex: "authorized_at",
    width: 100
  }, {
    title: "商品映射",
    dataIndex: "listings",
    width: 80
  }, {
    title: "订单",
    dataIndex: "orders",
    width: 70
  }, {
    title: "API 用量/日",
    width: 130,
    dataIndex: "api_used",
    render: (v, r) => React.createElement(Progress, {
      percent: Math.min(100, Math.round(v / r.api_quota * 100)),
      size: "small"
    })
  }, {
    title: "操作",
    width: 150,
    fixed: "right",
    render: (_, r) => React.createElement(Space, null, r.auth_status === "authorized" ? React.createElement(Button, {
      size: "small",
      danger: true,
      onClick: () => act(r.id, () => post(`/api/shops/${r.id}/revoke`), "已解除授权")
    }, "解除") : React.createElement(Button, {
      size: "small",
      type: "primary",
      onClick: () => act(r.id, () => post(`/api/shops/${r.id}/auth`), "授权成功")
    }, "授权"))
  }];
  return React.createElement("div", null, React.createElement(Card, {
    size: "small",
    style: {
      marginBottom: 12
    },
    extra: React.createElement(Button, {
      type: "primary",
      onClick: () => setOpen(true)
    }, "+ 新增店铺")
  }, React.createElement(Space, {
    size: 24
  }, React.createElement("span", null, "共 ", React.createElement("b", null, rows.length), " 家店铺"), React.createElement("span", null, "按分组：", groups.map(g => React.createElement(Tag, {
    key: g,
    color: "geekblue"
  }, `${g} ${rows.filter(r => r.group === g).length}`))), React.createElement("span", null, "按主体：", [...new Set(rows.map(r => r.entity))].length, " 个法人主体"))), React.createElement(Table, {
    rowKey: "id",
    size: "small",
    scroll: {
      x: 1400
    },
    dataSource: rows,
    columns: cols,
    pagination: false
  }), React.createElement(Modal, {
    open,
    title: "新增店铺（模拟 OAuth 授权）",
    onCancel: () => setOpen(false),
    onOk: async () => {
      try {
        await post("/api/shops", {
          ...form,
          platform_id: Number(form.platform_id)
        });
        message.success("已创建，请在列表中点击授权");
        setOpen(false);
        load();
      } catch (e) {
        message.error(e.message);
      }
    }
  }, React.createElement(Form, {
    layout: "vertical"
  }, React.createElement(Form.Item, {
    label: "店铺编码"
  }, React.createElement(Input, {
    value: form.code,
    onChange: e => setForm({
      ...form,
      code: e.target.value
    }),
    placeholder: "如 TB-003"
  })), React.createElement(Form.Item, {
    label: "店铺名称"
  }, React.createElement(Input, {
    value: form.name,
    onChange: e => setForm({
      ...form,
      name: e.target.value
    })
  })), React.createElement(Form.Item, {
    label: "所属平台"
  }, React.createElement(Select, {
    style: {
      width: "100%"
    },
    value: form.platform_id || undefined,
    onChange: v => setForm({
      ...form,
      platform_id: v
    })
  }, plats.map(p => React.createElement(Option, {
    key: p.id,
    value: p.id
  }, p.name)))), React.createElement(Form.Item, {
    label: "经营主体（法人）"
  }, React.createElement(Input, {
    value: form.entity,
    onChange: e => setForm({
      ...form,
      entity: e.target.value
    })
  })), React.createElement(Form.Item, {
    label: "店铺分组"
  }, React.createElement(Input, {
    value: form.group,
    onChange: e => setForm({
      ...form,
      group: e.target.value
    })
  })))));
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
  useEffect(() => {
    load();
  }, [shopFilter]);
  const cols = [{
    title: "系统SKU",
    dataIndex: "sku",
    width: 130,
    render: v => React.createElement("span", {
      className: "mono"
    }, v)
  }, {
    title: "商品名称",
    dataIndex: "name",
    width: 200
  }, {
    title: "分类",
    dataIndex: "category",
    width: 90
  }, {
    title: "规格",
    dataIndex: "spec",
    width: 110
  }, {
    title: "成本",
    dataIndex: "cost_price",
    width: 80,
    render: money
  }, {
    title: "售价",
    dataIndex: "sale_price",
    width: 80,
    render: money
  }, {
    title: "重量(kg)",
    dataIndex: "weight_kg",
    width: 80
  }, {
    title: "全渠道可用",
    dataIndex: "available",
    width: 100,
    render: v => React.createElement("b", {
      style: {
        color: v < 20 ? "#f5222d" : "#52c41a"
      }
    }, v)
  }, {
    title: "已铺店铺",
    dataIndex: "shop_count",
    width: 90
  }, {
    title: "组合装",
    dataIndex: "is_bundle",
    width: 150,
    render: (v, r) => v ? React.createElement("span", null, React.createElement(Tag, {
      color: "purple"
    }, "组合装"), r.bundle.map((b, i) => React.createElement("span", {
      key: i,
      className: "dim mono"
    }, `${b.sku}×${b.qty} `))) : React.createElement("span", {
      className: "dim"
    }, "单品")
  }];
  const lcols = [{
    title: "店铺",
    dataIndex: "shop",
    width: 170
  }, {
    title: "系统SKU",
    dataIndex: "sku",
    width: 130,
    render: v => React.createElement("span", {
      className: "mono"
    }, v)
  }, {
    title: "商品",
    dataIndex: "name",
    width: 180
  }, {
    title: "平台商品ID",
    dataIndex: "platform_item_id",
    width: 160,
    render: v => React.createElement("span", {
      className: "mono dim"
    }, v)
  }, {
    title: "平台标题",
    dataIndex: "platform_title",
    width: 200
  }, {
    title: "平台价",
    dataIndex: "platform_price",
    width: 90,
    render: money
  }, {
    title: "与标准价差",
    dataIndex: "diff_price",
    width: 100,
    render: v => React.createElement("span", {
      style: {
        color: v < 0 ? "#f5222d" : "#52c41a"
      }
    }, (v > 0 ? "+" : "") + v.toFixed(2))
  }, {
    title: "平台库存",
    dataIndex: "platform_stock",
    width: 90
  }, {
    title: "状态",
    dataIndex: "online_status",
    width: 80,
    render: v => React.createElement(Tag, {
      color: v === "online" ? "green" : "default"
    }, v === "online" ? "在售" : "下架")
  }];
  return React.createElement("div", null, React.createElement(Tabs, {
    items: [{
      key: "1",
      label: `统一商品池（${rows.length}）`,
      children: React.createElement("div", null, React.createElement(Card, {
        size: "small",
        style: {
          marginBottom: 12
        }
      }, React.createElement(Space, null, React.createElement(Input.Search, {
        placeholder: "搜索 SKU 或商品名",
        style: {
          width: 260
        },
        onSearch: v => {
          setKw(v);
          api("/api/products?kw=" + v).then(setRows);
        }
      }), React.createElement("span", {
        className: "dim"
      }, "一个系统 SKU 可映射到多个平台的多个商品，库存统一扣减"))), React.createElement(Table, {
        rowKey: "id",
        size: "small",
        scroll: {
          x: 1300
        },
        columns: cols,
        dataSource: rows,
        pagination: {
          pageSize: 12
        }
      }))
    }, {
      key: "2",
      label: `平台商品映射（${listings.length}）`,
      children: React.createElement("div", null, React.createElement(Card, {
        size: "small",
        style: {
          marginBottom: 12
        }
      }, React.createElement(Space, null, React.createElement("span", null, "店铺筛选"), React.createElement(Select, {
        style: {
          width: 220
        },
        value: shopFilter || undefined,
        onChange: v => setShopFilter(v || 0)
      }, React.createElement(Option, {
        value: 0
      }, "全部店铺"), shops.map(s => React.createElement(Option, {
        key: s.id,
        value: s.id
      }, s.name)))), React.createElement("div", {
        className: "dim",
        style: {
          marginTop: 6
        }
      }, "发货后系统按统一库存池自动回写各平台可售库存，避免多店铺超卖")), React.createElement(Table, {
        rowKey: "id",
        size: "small",
        scroll: {
          x: 1300
        },
        columns: lcols,
        dataSource: listings,
        pagination: {
          pageSize: 12
        }
      }))
    }]
  }));
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
  useEffect(() => {
    load();
  }, [load]);
  const cols = [{
    title: "仓库",
    dataIndex: "warehouse",
    width: 140
  }, {
    title: "SKU",
    dataIndex: "sku",
    width: 120,
    render: v => React.createElement("span", {
      className: "mono"
    }, v)
  }, {
    title: "商品",
    dataIndex: "name",
    width: 190
  }, {
    title: "实物",
    dataIndex: "on_hand",
    width: 70
  }, {
    title: "锁定",
    dataIndex: "locked",
    width: 70,
    render: v => React.createElement("span", {
      style: {
        color: v ? "#fa8c16" : "#999"
      }
    }, v)
  }, {
    title: "预留",
    dataIndex: "reserved",
    width: 70
  }, {
    title: "在途",
    dataIndex: "inbound",
    width: 70
  }, {
    title: "安全库存",
    dataIndex: "safety_stock",
    width: 90
  }, {
    title: "可用库存",
    dataIndex: "available",
    width: 100,
    render: (v, r) => React.createElement("b", {
      style: {
        color: r.alert ? "#f5222d" : "#52c41a"
      }
    }, v)
  }, {
    title: "状态",
    dataIndex: "alert",
    width: 90,
    render: v => v ? React.createElement(Tag, {
      color: "red"
    }, "低于安全线") : React.createElement(Tag, {
      color: "green"
    }, "正常")
  }, {
    title: "操作",
    width: 90,
    render: (_, r) => React.createElement(Button, {
      size: "small",
      onClick: () => setAdj({
        ...r,
        qty: 10
      })
    }, "调整")
  }];
  const lcols = [{
    title: "时间",
    dataIndex: "time",
    width: 110
  }, {
    title: "仓库",
    dataIndex: "warehouse",
    width: 130
  }, {
    title: "SKU",
    dataIndex: "sku",
    width: 120,
    render: v => React.createElement("span", {
      className: "mono"
    }, v)
  }, {
    title: "商品",
    dataIndex: "name",
    width: 180
  }, {
    title: "变动类型",
    dataIndex: "type",
    width: 110,
    render: v => React.createElement(Tag, {
      color: {
        lock: "orange",
        unlock: "blue",
        ship: "green",
        adjust: "purple",
        purchase: "cyan",
        return_in: "geekblue"
      }[v] || "default"
    }, v)
  }, {
    title: "变动量",
    dataIndex: "qty",
    width: 80,
    render: v => React.createElement("b", {
      style: {
        color: v > 0 ? "#52c41a" : "#f5222d"
      }
    }, v > 0 ? "+" + v : v)
  }, {
    title: "变动前可用",
    dataIndex: "before",
    width: 100
  }, {
    title: "变动后可用",
    dataIndex: "after",
    width: 100
  }, {
    title: "关联单据",
    dataIndex: "ref",
    width: 150
  }, {
    title: "操作人",
    dataIndex: "operator",
    width: 90
  }];
  const rcols = [{
    title: "规则名称",
    dataIndex: "name",
    width: 200
  }, {
    title: "适用范围",
    dataIndex: "scope",
    width: 180
  }, {
    title: "发货仓",
    dataIndex: "warehouse",
    width: 150
  }, {
    title: "优先级",
    dataIndex: "priority",
    width: 80
  }, {
    title: "可出货比例",
    dataIndex: "share_ratio",
    width: 110,
    render: v => Math.round(v * 100) + "%"
  }, {
    title: "状态",
    dataIndex: "enabled",
    width: 80,
    render: v => React.createElement(Tag, {
      color: v ? "green" : "default"
    }, v ? "启用" : "停用")
  }];
  return React.createElement("div", null, React.createElement(Row, {
    gutter: 12,
    style: {
      marginBottom: 12
    }
  }, whs.map(w => React.createElement(Col, {
    span: 8,
    key: w.id
  }, React.createElement(Card, {
    size: "small",
    title: `${w.name}（${w.wtype}·${w.city}）`
  }, React.createElement(Row, {
    gutter: 8
  }, React.createElement(Col, {
    span: 8
  }, React.createElement(Statistic, {
    title: "实物",
    value: w.on_hand
  })), React.createElement(Col, {
    span: 8
  }, React.createElement(Statistic, {
    title: "锁定",
    value: w.locked,
    valueStyle: {
      color: "#fa8c16"
    }
  })), React.createElement(Col, {
    span: 8
  }, React.createElement(Statistic, {
    title: "可用",
    value: w.available,
    valueStyle: {
      color: "#52c41a"
    }
  }))))))), React.createElement(Tabs, {
    items: [{
      key: "1",
      label: "库存池",
      children: React.createElement("div", null, React.createElement(Card, {
        size: "small",
        style: {
          marginBottom: 12
        }
      }, React.createElement(Space, null, React.createElement(Input.Search, {
        placeholder: "搜索 SKU / 商品名",
        style: {
          width: 240
        },
        onChange: e => setKw(e.target.value),
        onSearch: v => setKw(v)
      }), React.createElement(Checkbox, {
        checked: alertOnly,
        onChange: e => setAlertOnly(e.target.checked)
      }, "仅看预警"), React.createElement("span", {
        className: "dim"
      }, "可用 = 实物 − 锁定 − 预留（在途不计入可售）"))), React.createElement(Table, {
        rowKey: "id",
        size: "small",
        scroll: {
          x: 1250
        },
        columns: cols,
        dataSource: rows,
        pagination: {
          pageSize: 12
        }
      }))
    }, {
      key: "2",
      label: "库存流水",
      children: React.createElement(Table, {
        rowKey: "id",
        size: "small",
        scroll: {
          x: 1200
        },
        columns: lcols,
        dataSource: ledger,
        pagination: {
          pageSize: 12
        }
      })
    }, {
      key: "3",
      label: "库存分配规则",
      children: React.createElement("div", null, React.createElement(Alert, {
        type: "info",
        showIcon: true,
        style: {
          marginBottom: 12
        },
        message: "多店铺共享一个库存池时，按优先级选仓；可出货比例用于给某渠道/店铺预留库存，避免单一店铺把货卖空。"
      }), React.createElement(Table, {
        rowKey: "id",
        size: "small",
        columns: rcols,
        dataSource: rules,
        pagination: false
      }))
    }]
  }), React.createElement(Modal, {
    open: !!adj,
    title: "库存调整",
    onCancel: () => setAdj(null),
    onOk: async () => {
      try {
        await post("/api/inventory/adjust", {
          warehouse_id: adj.id,
          product_id: 0,
          qty: adj.qty
        });
      } catch (e) {}
      message.info("演示环境：调整需传 warehouse_id + product_id，请在库存池中操作");
      setAdj(null);
    }
  }, adj ? React.createElement("div", null, React.createElement("p", null, adj.sku, " ", adj.name, " · ", adj.warehouse), React.createElement(InputNumber, {
    value: adj.qty,
    onChange: v => setAdj({
      ...adj,
      qty: v
    })
  })) : null));
}

/* ============ 页面：订单中心（核心） ============ */
function Orders({
  onNotify
}) {
  const [rows, setRows] = useState([]);
  const [shops, setShops] = useState([]);
  const [tab, setTab] = useState("");
  const [kw, setKw] = useState("");
  const [sel, setSel] = useState([]);
  const [detail, setDetail] = useState(null);
  const [sim, setSim] = useState(false);
  const [simResult, setSimResult] = useState(null);
  const [simForm, setSimForm] = useState({
    count: 5,
    shop_id: 0,
    product_sku: "",
    qty: 2,
    auto_audit: true
  });
  const [print, setPrint] = useState(null);
  const load = useCallback(() => {
    api(`/api/orders?status=${tab}&kw=${kw}`).then(setRows);
  }, [tab, kw]);
  useEffect(() => {
    load();
    api("/api/shops").then(setShops);
  }, [load]);
  const doAct = async (fn, ok) => {
    try {
      const r = await fn();
      message.success(ok || r && r.msg || "操作成功");
      load();
      if (r) return r;
    } catch (e) {
      message.error(e.message);
    }
  };
  const cols = [{
    title: "订单号",
    dataIndex: "order_no",
    width: 170,
    render: (v, r) => React.createElement("a", {
      onClick: () => api("/api/orders/" + r.id).then(setDetail)
    }, React.createElement("span", {
      className: "mono"
    }, v))
  }, {
    title: "店铺",
    dataIndex: "shop",
    width: 160
  }, {
    title: "平台",
    dataIndex: "platform",
    width: 80,
    render: v => React.createElement(Tag, {
      color: "blue"
    }, v)
  }, {
    title: "买家/收件",
    width: 150,
    render: (_, r) => React.createElement("div", null, React.createElement("div", null, r.receiver), React.createElement("div", {
      className: "dim mono"
    }, r.phone))
  }, {
    title: "收货地",
    width: 150,
    render: (_, r) => `${r.province}${r.city}`
  }, {
    title: "金额",
    dataIndex: "amount",
    width: 90,
    render: money
  }, {
    title: "状态",
    dataIndex: "status_label",
    width: 100,
    render: (v, r) => React.createElement(Tag, {
      color: STATUS_COLOR[r.status]
    }, v)
  }, {
    title: "审核结果",
    width: 200,
    dataIndex: "audit_msg",
    render: (v, r) => React.createElement("div", {
      className: "audit-msg"
    }, r.audit_result ? React.createElement(Tag, {
      color: {
        pass: "green",
        hold: "orange",
        block: "red"
      }[r.audit_result]
    }, r.audit_result) : null, React.createElement("span", {
      className: "dim"
    }, v))
  }, {
    title: "发货仓",
    dataIndex: "warehouse",
    width: 120
  }, {
    title: "快递",
    dataIndex: "carrier",
    width: 90
  }, {
    title: "运单号",
    dataIndex: "waybill_no",
    width: 150,
    render: v => v ? React.createElement("span", {
      className: "mono"
    }, v) : null
  }, {
    title: "操作",
    width: 260,
    fixed: "right",
    render: (_, r) => React.createElement(Space, {
      size: 4,
      wrap: true
    }, (r.status === "pending" || r.status === "auditing") && React.createElement(Button, {
      size: "small",
      type: "primary",
      onClick: () => doAct(() => post(`/api/orders/${r.id}/audit`))
    }, "审单"), r.status === "auditing" && React.createElement(Button, {
      size: "small",
      onClick: () => doAct(() => post(`/api/orders/${r.id}/approve`))
    }, "人工放行"), r.status === "waiting" && React.createElement(Button, {
      size: "small",
      type: "primary",
      onClick: () => doAct(() => post(`/api/orders/${r.id}/ship`))
    }, "发货"), r.status === "waiting" && React.createElement(Button, {
      size: "small",
      onClick: () => setPrint(r)
    }, "打单"), (r.status === "pending" || r.status === "auditing" || r.status === "waiting") && React.createElement(Button, {
      size: "small",
      onClick: () => doAct(() => post(`/api/orders/${r.id}/split`))
    }, "拆单"), (r.status === "pending" || r.status === "auditing" || r.status === "waiting") && React.createElement(Popconfirm, {
      title: "确认拦截该订单？",
      onConfirm: () => doAct(() => post(`/api/orders/${r.id}/intercept`))
    }, React.createElement(Button, {
      size: "small",
      danger: true
    }, "拦截")))
  }];
  const TABS = [{
    key: "",
    label: "全部"
  }, {
    key: "pending",
    label: "待审单"
  }, {
    key: "auditing",
    label: "挂起待处理"
  }, {
    key: "waiting",
    label: "待发货"
  }, {
    key: "shipped",
    label: "已发货"
  }, {
    key: "intercepted",
    label: "已拦截"
  }];
  return React.createElement("div", null, React.createElement(Card, {
    size: "small",
    style: {
      marginBottom: 12
    }
  }, React.createElement(Space, {
    wrap: true
  }, React.createElement(Button, {
    type: "primary",
    onClick: () => setSim(true)
  }, "模拟平台推单"), React.createElement(Input.Search, {
    placeholder: "订单号 / 买家 / 收件人",
    style: {
      width: 220
    },
    onChange: e => setKw(e.target.value),
    onSearch: v => setKw(v)
  }), React.createElement("span", {
    className: "dim"
  }, `已选 ${sel.length} 单`), React.createElement(Button, {
    disabled: !sel.length,
    onClick: async () => {
      const r = await post("/api/orders/batch-audit", {
        ids: sel
      });
      notification.info({
        message: `批量审单结果：通过 ${r.pass} / 挂起 ${r.hold} / 拦截 ${r.block}`,
        description: (r.msgs || []).join("；")
      });
      load();
      setSel([]);
    }
  }, "批量审单"), React.createElement(Button, {
    disabled: !sel.length,
    onClick: async () => {
      const r = await post("/api/orders/batch-ship", {
        ids: sel
      });
      message.success(`发货成功 ${r.ok} 单，跳过 ${r.fail} 单`);
      load();
      setSel([]);
    }
  }, "批量发货"), React.createElement(Button, {
    disabled: sel.length < 2,
    onClick: async () => {
      const r = await post("/api/orders/merge", {
        ids: sel
      });
      r.ok ? message.success(`已合并为 ${r.order_no}，共 ${r.count} 单`) : message.warning(r.msg);
      load();
      setSel([]);
    }
  }, "同买家合单"))), React.createElement(Tabs, {
    activeKey: tab || "",
    onChange: k => setTab(k),
    items: TABS.map(t => ({
      key: t.key,
      label: t.label
    }))
  }), React.createElement(Table, {
    rowKey: "id",
    size: "small",
    scroll: {
      x: 1900
    },
    columns: cols,
    dataSource: rows,
    pagination: {
      pageSize: 15
    },
    rowSelection: {
      selectedRowKeys: sel,
      onChange: setSel
    }
  }), React.createElement(Drawer, {
    open: !!detail,
    title: detail ? `订单明细 ${detail.order_no}` : "",
    width: 620,
    onClose: () => setDetail(null)
  }, detail ? React.createElement("div", null, React.createElement(Descriptions, {
    bordered: true,
    size: "small",
    column: 2
  }, React.createElement(Descriptions.Item, {
    label: "店铺"
  }, detail.shop), React.createElement(Descriptions.Item, {
    label: "平台"
  }, detail.platform), React.createElement(Descriptions.Item, {
    label: "买家"
  }, detail.buyer_nick), React.createElement(Descriptions.Item, {
    label: "收件人"
  }, `${detail.receiver} ${detail.phone}`), React.createElement(Descriptions.Item, {
    label: "收货地址",
    span: 2
  }, `${detail.province}${detail.city}${detail.address}`), React.createElement(Descriptions.Item, {
    label: "订单金额"
  }, money(detail.amount)), React.createElement(Descriptions.Item, {
    label: "运费"
  }, money(detail.freight)), React.createElement(Descriptions.Item, {
    label: "状态"
  }, React.createElement(Tag, {
    color: STATUS_COLOR[detail.status]
  }, detail.status_label)), React.createElement(Descriptions.Item, {
    label: "发货仓"
  }, detail.warehouse || "-"), React.createElement(Descriptions.Item, {
    label: "快递"
  }, detail.carrier || "-"), React.createElement(Descriptions.Item, {
    label: "运单号"
  }, detail.waybill_no || "-"), React.createElement(Descriptions.Item, {
    label: "买家备注",
    span: 2
  }, detail.remark || "-"), React.createElement(Descriptions.Item, {
    label: "审核结果",
    span: 2
  }, detail.audit_msg || "-")), React.createElement(Divider, null, "商品明细"), React.createElement(Table, {
    size: "small",
    rowKey: "sku",
    pagination: false,
    dataSource: detail.items || [],
    columns: [{
      title: "SKU",
      dataIndex: "sku",
      render: v => React.createElement("span", {
        className: "mono"
      }, v)
    }, {
      title: "商品",
      dataIndex: "name"
    }, {
      title: "单价",
      dataIndex: "price",
      render: money
    }, {
      title: "数量",
      dataIndex: "qty"
    }, {
      title: "小计",
      render: (_, r) => money(r.price * r.qty)
    }]
  })) : null), React.createElement(Modal, {
    open: sim,
    title: "模拟平台推单（抓单 → 审单 → 锁库存）",
    width: 760,
    onCancel: () => setSim(false),
    onOk: async () => {
      const r = await post("/api/simulate/inbound", simForm);
      setSimResult(r.results);
      setSim(false);
      load();
    }
  }, React.createElement(Form, {
    layout: "vertical"
  }, React.createElement(Row, {
    gutter: 12
  }, React.createElement(Col, {
    span: 8
  }, React.createElement(Form.Item, {
    label: "推单笔数"
  }, React.createElement(InputNumber, {
    min: 1,
    max: 50,
    value: simForm.count,
    style: {
      width: "100%"
    },
    onChange: v => setSimForm({
      ...simForm,
      count: v
    })
  }))), React.createElement(Col, {
    span: 8
  }, React.createElement(Form.Item, {
    label: "指定店铺"
  }, React.createElement(Select, {
    style: {
      width: "100%"
    },
    value: simForm.shop_id || undefined,
    onChange: v => setSimForm({
      ...simForm,
      shop_id: v || 0
    })
  }, React.createElement(Option, {
    value: 0
  }, "随机"), shops.map(s => React.createElement(Option, {
    key: s.id,
    value: s.id
  }, s.name))))), React.createElement(Col, {
    span: 8
  }, React.createElement(Form.Item, {
    label: "指定商品SKU"
  }, React.createElement(Input, {
    placeholder: "留空随机，如 SKU-1009",
    value: simForm.product_sku,
    onChange: e => setSimForm({
      ...simForm,
      product_sku: e.target.value
    })
  })))), React.createElement(Row, {
    gutter: 12
  }, React.createElement(Col, {
    span: 8
  }, React.createElement(Form.Item, {
    label: "每单件数"
  }, React.createElement(InputNumber, {
    min: 1,
    max: 50,
    value: simForm.qty,
    style: {
      width: "100%"
    },
    onChange: v => setSimForm({
      ...simForm,
      qty: v
    })
  }))), React.createElement(Col, {
    span: 16
  }, React.createElement(Form.Item, {
    label: " "
  }, React.createElement(Checkbox, {
    checked: simForm.auto_audit,
    onChange: e => setSimForm({
      ...simForm,
      auto_audit: e.target.checked
    })
  }, "推单后立即执行审单规则并锁定库存")))), React.createElement(Alert, {
    type: "warning",
    showIcon: true,
    style: {
      marginTop: 8
    },
    message: "防超卖演示：指定 SKU-1009（紧缺品），推 15 单 × 每单 3 件，可看到前几单通过锁定、后续订单因库存不足被挂起。"
  }))), simResult ? React.createElement(Card, {
    size: "small",
    title: "推单结果",
    style: {
      marginTop: 12
    },
    extra: React.createElement(Button, {
      size: "small",
      onClick: () => setSimResult(null)
    }, "关闭")
  }, React.createElement(List, {
    size: "small",
    dataSource: simResult,
    renderItem: r => React.createElement(List.Item, null, React.createElement(Space, null, React.createElement("span", {
      className: "mono"
    }, r.order_no), React.createElement(Tag, null, r.shop), React.createElement("span", {
      className: "dim"
    }, money(r.amount)), React.createElement(Tag, {
      color: {
        pass: "green",
        hold: "orange",
        block: "red",
        pending: "blue"
      }[r.action]
    }, r.action), React.createElement("span", {
      className: "dim"
    }, r.msg)))
  })) : null, print ? React.createElement(Modal, {
    open: true,
    title: `打单 · ${print.order_no}`,
    width: 900,
    onCancel: () => setPrint(null),
    footer: null
  }, React.createElement(PrintPreview, {
    order: print
  })) : null);
}

/* ============ 打印预览 ============ */
function PrintPreview({
  order
}) {
  const [tpl, setTpl] = useState("waybill_default");
  const [html, setHtml] = useState("");
  const [meta, setMeta] = useState({});
  const [tpls, setTpls] = useState([]);
  useEffect(() => {
    api("/api/templates").then(t => setTpls(t.filter(x => x.enabled)));
  }, []);
  useEffect(() => {
    api(`/api/orders/${order.id}/print?tpl=${tpl}`).then(r => {
      setHtml(r.html);
      setMeta(r);
    });
  }, [tpl, order.id]);
  return React.createElement("div", null, React.createElement(Space, {
    style: {
      marginBottom: 12
    }
  }, React.createElement("span", null, "选择单据模板："), React.createElement(Select, {
    style: {
      width: 260
    },
    value: tpl,
    onChange: setTpl
  }, tpls.map(t => React.createElement(Option, {
    key: t.code,
    value: t.code
  }, `${t.name}（${t.paper}mm）`))), React.createElement(Button, {
    onClick: () => {
      const w = window.open("", "_blank");
      w.document.write(`<html><head><title>打印</title><style>@page{size:${meta.w}mm ${meta.h}mm;margin:0}body{margin:0;font-family:'Noto Sans CJK SC',sans-serif}</style></head><body>${html}<script>window.print()<\/script></body></html>`);
      w.document.close();
    }
  }, "调用打印机")), React.createElement("div", {
    className: "paper-wrap"
  }, React.createElement("div", {
    className: "paper",
    style: {
      width: meta.w + "mm",
      minHeight: meta.h + "mm"
    },
    dangerouslySetInnerHTML: {
      __html: html
    }
  })));
}

/* ============ 页面：打印模板中心 ============ */
function Templates() {
  const [tpls, setTpls] = useState([]);
  const [cur, setCur] = useState(null);
  const [vars, setVars] = useState([]);
  const [html, setHtml] = useState("");
  const [meta, setMeta] = useState({});
  useEffect(() => {
    api("/api/templates").then(setTpls);
    api("/api/template-vars").then(setVars);
  }, []);
  const open = async id => {
    const t = await api("/api/templates/" + id);
    setCur(t);
    const r = await api(`/api/templates/${id}/preview`);
    setHtml(r.html);
    setMeta(r);
  };
  const save = async () => {
    await put(`/api/templates/${cur.id}`, {
      name: cur.name,
      content: cur.content,
      width_mm: cur.width_mm,
      height_mm: cur.height_mm
    });
    message.success("模板已保存");
    const r = await api(`/api/templates/${cur.id}/preview`);
    setHtml(r.html);
    setMeta(r);
    api("/api/templates").then(setTpls);
  };
  const insert = k => setCur({
    ...cur,
    content: cur.content + `{{${k}}}`
  });
  return React.createElement(Row, {
    gutter: 12
  }, React.createElement(Col, {
    span: 6
  }, React.createElement(Card, {
    size: "small",
    title: "单据模板"
  }, React.createElement(List, {
    size: "small",
    dataSource: tpls,
    renderItem: t => React.createElement(List.Item, {
      onClick: () => open(t.id),
      className: cur && cur.id === t.id ? "tpl-active" : "tpl-item"
    }, React.createElement("div", null, React.createElement("div", null, React.createElement("b", null, t.name)), React.createElement("div", {
      className: "dim"
    }, `${t.ttype} · ${t.paper}mm · 更新 ${t.updated_at}`)))
  }))), React.createElement(Col, {
    span: 10
  }, React.createElement(Card, {
    size: "small",
    title: cur ? `编辑：${cur.name}` : "选择左侧模板",
    extra: cur ? React.createElement(Button, {
      type: "primary",
      size: "small",
      onClick: save
    }, "保存并预览") : null
  }, cur ? React.createElement("div", null, React.createElement(Space, {
    style: {
      marginBottom: 8
    }
  }, React.createElement("span", null, "纸张 宽"), React.createElement(InputNumber, {
    size: "small",
    value: cur.width_mm,
    onChange: v => setCur({
      ...cur,
      width_mm: v
    })
  }), React.createElement("span", null, "mm 高"), React.createElement(InputNumber, {
    size: "small",
    value: cur.height_mm,
    onChange: v => setCur({
      ...cur,
      height_mm: v
    })
  }), React.createElement("span", null, "mm")), React.createElement(TextArea, {
    value: cur.content,
    rows: 20,
    className: "mono",
    onChange: e => setCur({
      ...cur,
      content: e.target.value
    })
  }), React.createElement(Divider, {
    plain: true
  }, "可用变量（点击插入）"), React.createElement("div", null, vars.map(v => React.createElement(Tag, {
    key: v.key,
    style: {
      cursor: "pointer",
      marginBottom: 4
    },
    onClick: () => insert(v.key),
    title: `${v.desc} 示例：${v.sample}`
  }, `{{${v.key}}}`)))) : React.createElement(Empty, {
    description: "请选择模板"
  }))), React.createElement(Col, {
    span: 8
  }, React.createElement(Card, {
    size: "small",
    title: "实时预览（真实订单渲染）"
  }, html ? React.createElement("div", null, React.createElement("div", {
    className: "dim",
    style: {
      marginBottom: 6
    }
  }, `示例订单 ${meta.order_no} · ${meta.w}×${meta.h}mm`), React.createElement("div", {
    className: "paper-wrap"
  }, React.createElement("div", {
    className: "paper",
    style: {
      width: meta.w + "mm",
      minHeight: meta.h + "mm"
    },
    dangerouslySetInnerHTML: {
      __html: html
    }
  }))) : React.createElement(Empty, {
    description: "暂无预览"
  }))));
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
  useEffect(() => {
    load();
  }, []);
  const acols = [{
    title: "优先级",
    dataIndex: "priority",
    width: 70
  }, {
    title: "规则名称",
    dataIndex: "name",
    width: 180
  }, {
    title: "条件",
    width: 240,
    render: (_, r) => React.createElement("span", null, React.createElement(Tag, null, {
      min_amount: "金额≥",
      max_amount: "金额≤",
      address_contains: "地址含",
      remark_contains: "备注含",
      platform: "平台=",
      shop: "店铺=",
      out_of_stock: "缺货"
    }[r.cond_type] || r.cond_type), React.createElement("span", {
      className: "mono"
    }, r.cond_value || "-"))
  }, {
    title: "动作",
    dataIndex: "action",
    width: 90,
    render: v => React.createElement(Tag, {
      color: {
        pass: "green",
        hold: "orange",
        block: "red"
      }[v]
    }, {
      pass: "通过",
      hold: "挂起",
      block: "拦截"
    }[v])
  }, {
    title: "原因说明",
    dataIndex: "reason",
    width: 220
  }, {
    title: "操作",
    width: 70,
    render: (_, r) => React.createElement(Popconfirm, {
      title: "删除该规则？",
      onConfirm: async () => {
        await del("/api/audit-rules/" + r.id);
        message.success("已删除");
        load();
      }
    }, React.createElement(Button, {
      size: "small",
      danger: true
    }, "删除"))
  }];
  const scols = [{
    title: "优先级",
    dataIndex: "priority",
    width: 70
  }, {
    title: "规则名称",
    dataIndex: "name",
    width: 180
  }, {
    title: "适用店铺",
    dataIndex: "shop",
    width: 150
  }, {
    title: "省份关键字",
    dataIndex: "province_key",
    width: 160,
    render: v => v || React.createElement("span", {
      className: "dim"
    }, "不限")
  }, {
    title: "重量≤",
    dataIndex: "max_weight",
    width: 80
  }, {
    title: "金额≥",
    dataIndex: "min_amount",
    width: 80
  }, {
    title: "指定快递",
    dataIndex: "carrier",
    width: 110,
    render: v => React.createElement(Tag, {
      color: "blue"
    }, v)
  }, {
    title: "操作",
    width: 70,
    render: (_, r) => React.createElement(Popconfirm, {
      title: "删除？",
      onConfirm: async () => {
        await del("/api/ship-rules/" + r.id);
        load();
      }
    }, React.createElement(Button, {
      size: "small",
      danger: true
    }, "删除"))
  }];
  const stcols = [{
    title: "规则名称",
    dataIndex: "name",
    width: 200
  }, {
    title: "适用范围",
    dataIndex: "scope",
    width: 180
  }, {
    title: "发货仓",
    dataIndex: "warehouse",
    width: 150
  }, {
    title: "优先级",
    dataIndex: "priority",
    width: 80
  }, {
    title: "可出货比例",
    dataIndex: "share_ratio",
    width: 100,
    render: v => Math.round(v * 100) + "%"
  }];
  return React.createElement("div", null, React.createElement(Alert, {
    type: "info",
    showIcon: true,
    style: {
      marginBottom: 12
    },
    message: "规则引擎是自动化上限：条件 → 动作 → 优先级 → 例外。命中高优先级规则即停止匹配。"
  }), React.createElement(Tabs, {
    items: [{
      key: "1",
      label: `审单规则（${audit.length}）`,
      children: React.createElement("div", null, React.createElement(Space, {
        style: {
          marginBottom: 10
        }
      }, React.createElement(Button, {
        type: "primary",
        size: "small",
        onClick: () => setAdd({
          type: "audit",
          priority: 10,
          cond_type: "min_amount",
          action: "hold",
          name: "",
          cond_value: "",
          reason: ""
        })
      }, "+ 新增审单规则")), React.createElement(Table, {
        rowKey: "id",
        size: "small",
        columns: acols,
        dataSource: audit,
        pagination: false
      }))
    }, {
      key: "2",
      label: `快递分配规则（${ship.length}）`,
      children: React.createElement("div", null, React.createElement(Space, {
        style: {
          marginBottom: 10
        }
      }, React.createElement(Button, {
        type: "primary",
        size: "small",
        onClick: () => setAdd({
          type: "ship",
          name: "",
          priority: 10,
          province_key: "",
          max_weight: 9999,
          min_amount: 0,
          shop_id: 0,
          carrier_id: carriers[0] && carriers[0].id
        })
      }, "+ 新增快递规则")), React.createElement(Table, {
        rowKey: "id",
        size: "small",
        columns: scols,
        dataSource: ship,
        pagination: false
      }), React.createElement(Divider, null, "快递公司资费"), React.createElement(Table, {
        rowKey: "id",
        size: "small",
        pagination: false,
        dataSource: carriers,
        columns: [{
          title: "快递",
          dataIndex: "name"
        }, {
          title: "首重(元)",
          dataIndex: "base_fee"
        }, {
          title: "续重/kg",
          dataIndex: "per_kg_fee"
        }, {
          title: "偏远附加",
          dataIndex: "remote_surcharge"
        }, {
          title: "状态",
          dataIndex: "enabled",
          render: v => React.createElement(Tag, {
            color: v ? "green" : "default"
          }, v ? "启用" : "停用")
        }]
      }))
    }, {
      key: "3",
      label: `库存分配规则（${stock.length}）`,
      children: React.createElement(Table, {
        rowKey: "id",
        size: "small",
        columns: stcols,
        dataSource: stock,
        pagination: false
      })
    }]
  }), React.createElement(Modal, {
    open: !!add,
    title: add && add.type === "audit" ? "新增审单规则" : "新增快递规则",
    onCancel: () => setAdd(null),
    onOk: async () => {
      const p = add.type === "audit" ? "/api/audit-rules" : "/api/ship-rules";
      const body = {
        ...add
      };
      delete body.type;
      await post(p, body);
      message.success("已新增");
      setAdd(null);
      load();
    }
  }, add ? React.createElement(Form, {
    layout: "vertical"
  }, React.createElement(Form.Item, {
    label: "规则名称"
  }, React.createElement(Input, {
    value: add.name,
    onChange: e => setAdd({
      ...add,
      name: e.target.value
    })
  })), React.createElement(Form.Item, {
    label: "优先级（小者优先）"
  }, React.createElement(InputNumber, {
    value: add.priority,
    onChange: v => setAdd({
      ...add,
      priority: v
    })
  })), add.type === "audit" ? React.createElement("div", null, React.createElement(Form.Item, {
    label: "条件类型"
  }, React.createElement(Select, {
    style: {
      width: "100%"
    },
    value: add.cond_type,
    onChange: v => setAdd({
      ...add,
      cond_type: v
    })
  }, React.createElement(Option, {
    value: "min_amount"
  }, "订单金额 ≥"), React.createElement(Option, {
    value: "max_amount"
  }, "订单金额 ≤"), React.createElement(Option, {
    value: "address_contains"
  }, "收货地址包含"), React.createElement(Option, {
    value: "remark_contains"
  }, "买家备注包含"), React.createElement(Option, {
    value: "platform"
  }, "平台ID等于"), React.createElement(Option, {
    value: "shop"
  }, "店铺ID等于"), React.createElement(Option, {
    value: "out_of_stock"
  }, "库存不足"))), React.createElement(Form.Item, {
    label: "条件值"
  }, React.createElement(Input, {
    value: add.cond_value,
    onChange: e => setAdd({
      ...add,
      cond_value: e.target.value
    })
  })), React.createElement(Form.Item, {
    label: "动作"
  }, React.createElement(Select, {
    style: {
      width: "100%"
    },
    value: add.action,
    onChange: v => setAdd({
      ...add,
      action: v
    })
  }, React.createElement(Option, {
    value: "pass"
  }, "通过"), React.createElement(Option, {
    value: "hold"
  }, "挂起转人工"), React.createElement(Option, {
    value: "block"
  }, "直接拦截"))), React.createElement(Form.Item, {
    label: "原因说明"
  }, React.createElement(Input, {
    value: add.reason,
    onChange: e => setAdd({
      ...add,
      reason: e.target.value
    })
  }))) : React.createElement("div", null, React.createElement(Form.Item, {
    label: "省份关键字（逗号分隔，留空不限）"
  }, React.createElement(Input, {
    value: add.province_key,
    onChange: e => setAdd({
      ...add,
      province_key: e.target.value
    })
  })), React.createElement(Form.Item, {
    label: "重量上限(kg)"
  }, React.createElement(InputNumber, {
    value: add.max_weight,
    onChange: v => setAdd({
      ...add,
      max_weight: v
    })
  })), React.createElement(Form.Item, {
    label: "金额下限(元)"
  }, React.createElement(InputNumber, {
    value: add.min_amount,
    onChange: v => setAdd({
      ...add,
      min_amount: v
    })
  })), React.createElement(Form.Item, {
    label: "指定快递"
  }, React.createElement(Select, {
    style: {
      width: "100%"
    },
    value: add.carrier_id,
    onChange: v => setAdd({
      ...add,
      carrier_id: v
    })
  }, carriers.map(c => React.createElement(Option, {
    key: c.id,
    value: c.id
  }, c.name)))))) : null));
}

/* ============ 页面：系统设置 ============ */
function SystemPage() {
  const [users, setUsers] = useState([]);
  const [logs, setLogs] = useState([]);
  const [apis, setApis] = useState([]);
  useEffect(() => {
    api("/api/users").then(setUsers);
    api("/api/logs").then(setLogs);
    api("/api/openapi-spec").then(setApis);
  }, []);
  return React.createElement(Tabs, {
    items: [{
      key: "1",
      label: "组织与角色",
      children: React.createElement("div", null, React.createElement(Alert, {
        type: "warning",
        showIcon: true,
        style: {
          marginBottom: 12
        },
        message: "多店铺场景下，权限至少要能按「店铺 / 仓库 / 品牌 / 法人主体」四层隔离，否则跨部门数据会串。"
      }), React.createElement(Table, {
        rowKey: "id",
        size: "small",
        pagination: false,
        dataSource: users,
        columns: [{
          title: "账号",
          dataIndex: "username"
        }, {
          title: "姓名",
          dataIndex: "name"
        }, {
          title: "角色",
          dataIndex: "role_label",
          render: v => React.createElement(Tag, {
            color: "blue"
          }, v)
        }, {
          title: "数据范围",
          render: () => React.createElement("span", {
            className: "dim"
          }, "按店铺分组授权")
        }, {
          title: "状态",
          dataIndex: "enabled",
          render: v => React.createElement(Badge, {
            status: v ? "success" : "error",
            text: v ? "启用" : "停用"
          })
        }]
      }))
    }, {
      key: "2",
      label: "操作日志",
      children: React.createElement(Timeline, {
        style: {
          marginTop: 12
        },
        items: logs.map(l => ({
          children: React.createElement("div", null, React.createElement("span", {
            className: "dim mono"
          }, l.time), "  ", React.createElement(Tag, null, l.user), " ", React.createElement("b", null, l.action), " ", React.createElement("span", {
            className: "mono"
          }, l.target), " ", React.createElement("span", {
            className: "dim"
          }, l.detail))
        }))
      })
    }, {
      key: "3",
      label: "开放 API",
      children: React.createElement("div", null, React.createElement(Alert, {
        type: "info",
        showIcon: true,
        style: {
          marginBottom: 12
        },
        message: "开放平台决定能否对接自建 WMS、财务软件、BI 与第三方仓。采购时必须书面确认 QPS、日限额与版本兼容策略。"
      }), React.createElement(Table, {
        rowKey: "path",
        size: "small",
        pagination: false,
        dataSource: apis,
        columns: [{
          title: "接口",
          dataIndex: "path",
          width: 320,
          render: v => React.createElement("span", {
            className: "mono"
          }, v)
        }, {
          title: "说明",
          dataIndex: "desc"
        }, {
          title: "限流",
          dataIndex: "qps",
          width: 120,
          render: v => React.createElement(Tag, {
            color: "orange"
          }, v)
        }]
      }))
    }]
  });
}

/* ============ 主框架 ============ */
const BASE_PAGES = [{
  key: "dashboard",
  label: "经营概览",
  comp: Dashboard
}, {
  key: "shops",
  label: "多店铺管理",
  comp: Shops
}, {
  key: "products",
  label: "商品中心",
  comp: Products
}, {
  key: "inventory",
  label: "库存中心",
  comp: InventoryPage
}, {
  key: "orders",
  label: "订单履约",
  comp: Orders
}, {
  key: "print",
  label: "打印模板",
  comp: Templates
}, {
  key: "rules",
  label: "规则引擎",
  comp: Rules
}, {
  key: "system",
  label: "系统设置",
  comp: SystemPage
}];
function BaseApp() {
  const [cur, setCur] = useState((location.hash || "#dashboard").slice(1));
  useEffect(() => {
    const h = () => setCur((location.hash || "#dashboard").slice(1));
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, []);
  const page = PAGES.find(p => p.key === cur) || PAGES[0];
  return React.createElement(Layout, {
    style: {
      minHeight: "100vh"
    }
  }, React.createElement(Header, {
    className: "app-header"
  }, React.createElement("div", {
    className: "logo"
  }, React.createElement("span", {
    className: "cn"
  }, "塔奥"), React.createElement("span", {
    className: "en"
  }, "thalvior")), React.createElement("span", {
    className: "sub"
  }, "多平台 · 多店铺统一管理中枢"), React.createElement("div", {
    className: "header-right"
  }, React.createElement(Tag, {
    color: "green"
  }, "12 店铺已授权"), React.createElement(Tag, {
    color: "blue"
  }, "8 平台"), React.createElement(Tag, {
    color: "purple"
  }, "3 仓"), React.createElement("span", {
    className: "user"
  }, "admin · 超级管理员"))), React.createElement(Layout, null, React.createElement(Sider, {
    width: 168,
    theme: "light",
    className: "app-sider"
  }, React.createElement(Menu, {
    mode: "inline",
    selectedKeys: [page.key],
    style: {
      borderRight: 0
    },
    onClick: e => {
      location.hash = "#" + e.key;
    },
    items: PAGES.map(p => ({
      key: p.key,
      label: p.label
    }))
  })), React.createElement(Content, {
    className: "app-content"
  }, React.createElement(page.comp, {
    key: page.key
  }))));
}

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
  useEffect(() => {
    load();
  }, [load]);
  const scols = [{
    title: "编码",
    dataIndex: "code",
    width: 100,
    render: v => React.createElement("span", {
      className: "mono"
    }, v)
  }, {
    title: "供应商名称",
    dataIndex: "name",
    width: 200
  }, {
    title: "联系人",
    dataIndex: "contact",
    width: 90
  }, {
    title: "电话",
    dataIndex: "phone",
    width: 130
  }, {
    title: "账期",
    dataIndex: "pay_term",
    width: 100
  }, {
    title: "提前期",
    dataIndex: "lead_days",
    width: 80,
    render: v => v + " 天"
  }, {
    title: "信用额度",
    dataIndex: "credit_limit",
    width: 110,
    render: money
  }, {
    title: "评分",
    dataIndex: "score",
    width: 90,
    render: v => React.createElement(Tag, {
      color: v >= 90 ? "green" : "orange"
    }, v)
  }, {
    title: "采购单",
    dataIndex: "po_count",
    width: 80
  }, {
    title: "采购金额",
    dataIndex: "po_amount",
    width: 110,
    render: money
  }];
  const pcols = [{
    title: "采购单号",
    dataIndex: "po_no",
    width: 150,
    render: (v, r) => React.createElement("a", {
      onClick: () => api("/api/purchase-orders/" + r.id).then(setDetail)
    }, React.createElement("span", {
      className: "mono"
    }, v))
  }, {
    title: "供应商",
    dataIndex: "supplier",
    width: 180
  }, {
    title: "收货仓",
    dataIndex: "warehouse",
    width: 140
  }, {
    title: "状态",
    dataIndex: "status_label",
    width: 90,
    render: (v, r) => React.createElement(Tag, {
      color: {
        draft: "default",
        approved: "blue",
        partial: "orange",
        received: "green",
        cancelled: "red"
      }[r.status]
    }, v)
  }, {
    title: "金额",
    dataIndex: "amount",
    width: 100,
    render: money
  }, {
    title: "SKU数",
    dataIndex: "sku_count",
    width: 70
  }, {
    title: "到货进度",
    dataIndex: "progress",
    width: 150,
    render: (v, r) => React.createElement(Progress, {
      percent: v,
      size: "small",
      format: () => `${r.received}/${r.qty}`
    })
  }, {
    title: "预计到货",
    dataIndex: "expect_date",
    width: 110
  }, {
    title: "操作",
    width: 170,
    render: (_, r) => React.createElement(Space, {
      size: 4
    }, r.status !== "received" ? React.createElement(Button, {
      size: "small",
      type: "primary",
      onClick: async () => {
        const res = await post(`/api/purchase-orders/${r.id}/receive`);
        res.ok ? message.success(res.msg) : message.warning(res.msg);
        load();
      }
    }, "收货入库") : null, React.createElement(Button, {
      size: "small",
      onClick: async () => {
        const p = prods[0];
        if (!p) return;
        const res = await post(`/api/purchase-orders/${r.id}/return`, {
          product_id: p.id,
          qty: 5,
          reason: "来料不良"
        });
        res.ok ? message.success(res.msg) : message.warning(res.msg);
        load();
      }
    }, "退货"))
  }];
  const rcols = [{
    title: "入库单号",
    dataIndex: "rc_no",
    width: 160,
    render: v => React.createElement("span", {
      className: "mono"
    }, v)
  }, {
    title: "关联采购单",
    dataIndex: "po_no",
    width: 150
  }, {
    title: "收货仓",
    dataIndex: "warehouse",
    width: 150
  }, {
    title: "质检",
    dataIndex: "qc_pass",
    width: 80,
    render: v => React.createElement(Tag, {
      color: v ? "green" : "red"
    }, v ? "合格" : "不合格")
  }, {
    title: "操作人",
    dataIndex: "operator",
    width: 90
  }, {
    title: "时间",
    dataIndex: "created_at",
    width: 110
  }];
  const gcols = [{
    title: "SKU",
    dataIndex: "sku",
    width: 120,
    render: v => React.createElement("span", {
      className: "mono"
    }, v)
  }, {
    title: "商品",
    dataIndex: "name",
    width: 180
  }, {
    title: "仓库",
    dataIndex: "warehouse",
    width: 130
  }, {
    title: "可用",
    dataIndex: "available",
    width: 70,
    render: v => React.createElement("b", {
      style: {
        color: "#f5222d"
      }
    }, v)
  }, {
    title: "安全库存",
    dataIndex: "safety",
    width: 90
  }, {
    title: "在途",
    dataIndex: "inbound",
    width: 70
  }, {
    title: "建议采购",
    dataIndex: "suggest",
    width: 90,
    render: v => React.createElement("b", null, v)
  }, {
    title: "建议金额",
    dataIndex: "amount",
    width: 100,
    render: money
  }, {
    title: "建议供应商",
    dataIndex: "supplier",
    width: 170
  }, {
    title: "到货周期",
    dataIndex: "lead_days",
    width: 90,
    render: v => v + " 天"
  }, {
    title: "操作",
    width: 100,
    render: (_, r) => React.createElement(Button, {
      size: "small",
      type: "primary",
      onClick: () => setAdd({
        supplier_id: r.supplier_id,
        warehouse_id: whs[0] && whs[0].id,
        items: [{
          product_id: prods.find(p => p.sku === r.sku) && prods.find(p => p.sku === r.sku).id,
          qty: r.suggest
        }]
      })
    }, "生成采购单")
  }];
  return React.createElement("div", null, React.createElement(Alert, {
    type: "info",
    showIcon: true,
    style: {
      marginBottom: 12
    },
    message: "采购供应链：供应商 → 采购单 → 到货质检入库 → 采购退货。入库后实物库存与批次同时增加。"
  }), React.createElement(Tabs, {
    activeKey: tab,
    onChange: setTab,
    items: [{
      key: "1",
      label: `供应商（${sups.length}）`,
      children: React.createElement(Table, {
        rowKey: "id",
        size: "small",
        scroll: {
          x: 1200
        },
        columns: scols,
        dataSource: sups,
        pagination: false
      })
    }, {
      key: "2",
      label: `采购单（${pos.length}）`,
      children: React.createElement("div", null, React.createElement(Space, {
        style: {
          marginBottom: 10
        }
      }, React.createElement(Button, {
        type: "primary",
        size: "small",
        onClick: () => setAdd({
          supplier_id: sups[0] && sups[0].id,
          warehouse_id: whs[0] && whs[0].id,
          items: []
        })
      }, "+ 新建采购单")), React.createElement(Table, {
        rowKey: "id",
        size: "small",
        scroll: {
          x: 1250
        },
        columns: pcols,
        dataSource: pos,
        pagination: false
      }))
    }, {
      key: "3",
      label: `入库单（${rcs.length}）`,
      children: React.createElement(Table, {
        rowKey: "id",
        size: "small",
        columns: rcols,
        dataSource: rcs,
        pagination: false
      })
    }, {
      key: "4",
      label: `智能补货建议（${sug.length}）`,
      children: React.createElement("div", null, React.createElement("div", {
        className: "dim",
        style: {
          marginBottom: 8
        }
      }, "可用库存低于安全线或低于 30 件时触发，建议量 = max(安全库存×3, 50) − 可用 − 在途"), React.createElement(Table, {
        rowKey: "sku",
        size: "small",
        scroll: {
          x: 1250
        },
        columns: gcols,
        dataSource: sug,
        pagination: false
      }))
    }]
  }), React.createElement(Drawer, {
    open: !!detail,
    title: detail ? `采购明细 ${detail.po_no}` : "",
    width: 620,
    onClose: () => setDetail(null)
  }, detail ? React.createElement("div", null, React.createElement(Descriptions, {
    bordered: true,
    size: "small",
    column: 2
  }, React.createElement(Descriptions.Item, {
    label: "供应商"
  }, detail.supplier), React.createElement(Descriptions.Item, {
    label: "收货仓"
  }, detail.warehouse), React.createElement(Descriptions.Item, {
    label: "状态"
  }, detail.status), React.createElement(Descriptions.Item, {
    label: "金额"
  }, money(detail.amount)), React.createElement(Descriptions.Item, {
    label: "备注",
    span: 2
  }, detail.remark || "-")), React.createElement(Divider, null, "采购明细"), React.createElement(Table, {
    size: "small",
    rowKey: "sku",
    pagination: false,
    dataSource: detail.items,
    columns: [{
      title: "SKU",
      dataIndex: "sku",
      render: v => React.createElement("span", {
        className: "mono"
      }, v)
    }, {
      title: "商品",
      dataIndex: "name"
    }, {
      title: "采购量",
      dataIndex: "qty"
    }, {
      title: "已到货",
      dataIndex: "received_qty"
    }, {
      title: "单价",
      dataIndex: "price",
      render: money
    }, {
      title: "税率",
      dataIndex: "tax_rate",
      render: v => Math.round(v * 100) + "%"
    }, {
      title: "小计",
      render: (_, r) => money(r.qty * r.price)
    }]
  })) : null), React.createElement(Modal, {
    open: !!add,
    title: "新建采购单",
    width: 640,
    onCancel: () => setAdd(null),
    onOk: async () => {
      const items = (add.items || []).filter(i => i.product_id && i.qty > 0);
      if (!items.length) {
        message.warning("请至少添加一个商品");
        return;
      }
      const r = await post("/api/purchase-orders", add);
      r.ok ? message.success(`采购单 ${r.po_no} 已创建，金额 ${money(r.amount)}`) : message.warning("创建失败");
      setAdd(null);
      load();
    }
  }, add ? React.createElement(Form, {
    layout: "vertical"
  }, React.createElement(Form.Item, {
    label: "供应商"
  }, React.createElement(Select, {
    style: {
      width: "100%"
    },
    value: add.supplier_id || undefined,
    onChange: v => setAdd({
      ...add,
      supplier_id: v
    })
  }, sups.map(s => React.createElement(Option, {
    key: s.id,
    value: s.id
  }, `${s.name}（${s.pay_term}）`)))), React.createElement(Form.Item, {
    label: "收货仓"
  }, React.createElement(Select, {
    style: {
      width: "100%"
    },
    value: add.warehouse_id || undefined,
    onChange: v => setAdd({
      ...add,
      warehouse_id: v
    })
  }, whs.map(w => React.createElement(Option, {
    key: w.id,
    value: w.id
  }, w.name)))), React.createElement(Divider, null, "采购明细"), (add.items || []).map((it, idx) => React.createElement(Row, {
    gutter: 8,
    key: idx,
    style: {
      marginBottom: 8
    }
  }, React.createElement(Col, {
    span: 12
  }, React.createElement(Select, {
    style: {
      width: "100%"
    },
    placeholder: "选择商品",
    value: it.product_id || undefined,
    onChange: v => {
      const ns = [...add.items];
      ns[idx].product_id = v;
      setAdd({
        ...add,
        items: ns
      });
    }
  }, prods.map(p => React.createElement(Option, {
    key: p.id,
    value: p.id
  }, `${p.sku} ${p.name}`)))), React.createElement(Col, {
    span: 6
  }, React.createElement(InputNumber, {
    placeholder: "数量",
    style: {
      width: "100%"
    },
    value: it.qty,
    onChange: v => {
      const ns = [...add.items];
      ns[idx].qty = v;
      setAdd({
        ...add,
        items: ns
      });
    }
  })), React.createElement(Col, {
    span: 6
  }, React.createElement(Button, {
    danger: true,
    onClick: () => setAdd({
      ...add,
      items: add.items.filter((_, i) => i !== idx)
    })
  }, "删除")))), React.createElement(Button, {
    size: "small",
    onClick: () => setAdd({
      ...add,
      items: [...(add.items || []), {
        product_id: null,
        qty: 50
      }]
    })
  }, "+ 添加商品")) : null));
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
  useEffect(() => {
    load();
  }, [load]);
  const lcols = [{
    title: "库位编码",
    dataIndex: "code",
    width: 120,
    render: v => React.createElement("span", {
      className: "mono"
    }, v)
  }, {
    title: "仓库",
    dataIndex: "warehouse",
    width: 150
  }, {
    title: "库区",
    dataIndex: "zone",
    width: 90
  }, {
    title: "类型",
    dataIndex: "ltype",
    width: 100,
    render: v => React.createElement(Tag, {
      color: v === "拣货位" ? "blue" : "default"
    }, v)
  }, {
    title: "状态",
    dataIndex: "enabled",
    width: 80,
    render: v => React.createElement(Tag, {
      color: v ? "green" : "default"
    }, v ? "启用" : "停用")
  }];
  const bcols = [{
    title: "批次号",
    dataIndex: "batch_no",
    width: 150,
    render: v => React.createElement("span", {
      className: "mono"
    }, v)
  }, {
    title: "仓库",
    dataIndex: "warehouse",
    width: 130
  }, {
    title: "SKU",
    dataIndex: "sku",
    width: 110,
    render: v => React.createElement("span", {
      className: "mono"
    }, v)
  }, {
    title: "商品",
    dataIndex: "name",
    width: 170
  }, {
    title: "数量",
    dataIndex: "qty",
    width: 70
  }, {
    title: "成本价",
    dataIndex: "cost_price",
    width: 80,
    render: money
  }, {
    title: "库位",
    dataIndex: "location_code",
    width: 100
  }, {
    title: "生产日期",
    dataIndex: "produced_at",
    width: 110
  }, {
    title: "到期日",
    dataIndex: "expire_at",
    width: 110
  }, {
    title: "剩余天数",
    dataIndex: "expire_days",
    width: 100,
    render: (v, r) => React.createElement("b", {
      style: {
        color: r.alert ? "#f5222d" : "#52c41a"
      }
    }, r.expire_days >= 999 ? "-" : v)
  }, {
    title: "效期",
    dataIndex: "alert",
    width: 80,
    render: v => v ? React.createElement(Tag, {
      color: "red"
    }, "临期") : React.createElement(Tag, {
      color: "green"
    }, "正常")
  }];
  const wcols = [{
    title: "波次号",
    dataIndex: "wave_no",
    width: 150,
    render: (v, r) => React.createElement("a", {
      onClick: () => {
        setCurWave(r.id);
        api("/api/waves/" + r.id + "/tasks").then(setTasks);
        setTab("3");
      }
    }, React.createElement("span", {
      className: "mono"
    }, v))
  }, {
    title: "仓库",
    dataIndex: "warehouse",
    width: 140
  }, {
    title: "策略",
    dataIndex: "strategy",
    width: 90,
    render: v => React.createElement(Tag, {
      color: v === "摘果式" ? "blue" : "purple"
    }, v)
  }, {
    title: "订单数",
    dataIndex: "order_count",
    width: 80
  }, {
    title: "SKU数",
    dataIndex: "sku_count",
    width: 80
  }, {
    title: "总件数",
    dataIndex: "qty_total",
    width: 80
  }, {
    title: "状态",
    dataIndex: "status",
    width: 90,
    render: v => React.createElement(Tag, {
      color: {
        created: "blue",
        picking: "orange",
        packed: "cyan",
        done: "green"
      }[v]
    }, v)
  }, {
    title: "拣货人",
    dataIndex: "picker",
    width: 90
  }, {
    title: "操作",
    width: 110,
    render: (_, r) => React.createElement(Button, {
      size: "small",
      type: "primary",
      onClick: async () => {
        const res = await post(`/api/waves/${r.id}/pick`);
        message.success(res.msg);
        load();
      }
    }, "执行拣货")
  }];
  const tcols = [{
    title: "库位",
    dataIndex: "location_code",
    width: 110,
    render: v => React.createElement("span", {
      className: "mono"
    }, v)
  }, {
    title: "订单号",
    dataIndex: "order_no",
    width: 170,
    render: v => React.createElement("span", {
      className: "mono"
    }, v)
  }, {
    title: "SKU",
    dataIndex: "sku",
    width: 110,
    render: v => React.createElement("span", {
      className: "mono"
    }, v)
  }, {
    title: "商品",
    dataIndex: "name",
    width: 170
  }, {
    title: "应拣",
    dataIndex: "qty",
    width: 70
  }, {
    title: "实拣",
    dataIndex: "picked_qty",
    width: 70
  }, {
    title: "状态",
    dataIndex: "status",
    width: 90,
    render: v => React.createElement(Tag, {
      color: {
        pending: "default",
        picked: "green",
        short: "red"
      }[v]
    }, {
      pending: "待拣",
      picked: "已拣",
      short: "缺货"
    }[v])
  }];
  const pcols = [{
    title: "订单号",
    dataIndex: "order_no",
    width: 170,
    render: v => React.createElement("span", {
      className: "mono"
    }, v)
  }, {
    title: "实重(kg)",
    dataIndex: "weight_kg",
    width: 90
  }, {
    title: "运费",
    dataIndex: "freight",
    width: 90,
    render: money
  }, {
    title: "快递",
    dataIndex: "carrier",
    width: 100
  }, {
    title: "运单号",
    dataIndex: "waybill_no",
    width: 150,
    render: v => React.createElement("span", {
      className: "mono"
    }, v)
  }, {
    title: "结果",
    dataIndex: "result",
    width: 80,
    render: v => React.createElement(Tag, {
      color: v === "pass" ? "green" : "red"
    }, v)
  }, {
    title: "验货员",
    dataIndex: "operator",
    width: 90
  }, {
    title: "时间",
    dataIndex: "checked_at",
    width: 110
  }];
  const stcols = [{
    title: "盘点单号",
    dataIndex: "st_no",
    width: 160,
    render: (v, r) => React.createElement("a", {
      onClick: () => api("/api/stocktakes/" + r.id + "/items").then(setStItems)
    }, React.createElement("span", {
      className: "mono"
    }, v))
  }, {
    title: "仓库",
    dataIndex: "warehouse",
    width: 140
  }, {
    title: "方式",
    dataIndex: "mode",
    width: 80,
    render: v => React.createElement(Tag, {
      color: v === "明盘" ? "blue" : "purple"
    }, v)
  }, {
    title: "状态",
    dataIndex: "status",
    width: 90,
    render: v => React.createElement(Tag, {
      color: {
        draft: "default",
        counting: "orange",
        review: "cyan",
        done: "green"
      }[v]
    }, v)
  }, {
    title: "SKU数",
    dataIndex: "sku_count",
    width: 80
  }, {
    title: "差异件数",
    dataIndex: "diff_qty",
    width: 90,
    render: (v, r) => r.status === "done" ? React.createElement("b", {
      style: {
        color: v === 0 ? "#52c41a" : "#f5222d"
      }
    }, v > 0 ? "+" + v : v) : "-"
  }, {
    title: "损益金额",
    dataIndex: "diff_amount",
    width: 110,
    render: (v, r) => r.status === "done" ? money(v) : "-"
  }, {
    title: "操作",
    width: 150,
    render: (_, r) => React.createElement(Space, {
      size: 4
    }, React.createElement(Button, {
      size: "small",
      onClick: () => api("/api/stocktakes/" + r.id + "/items").then(setStItems)
    }, "明细"), r.status !== "done" ? React.createElement(Button, {
      size: "small",
      type: "primary",
      onClick: async () => {
        const res = await post(`/api/stocktakes/${r.id}/submit`);
        message.success(res.msg);
        load();
      }
    }, "提交盘点") : null)
  }];
  const tfcols = [{
    title: "调拨单号",
    dataIndex: "tf_no",
    width: 160,
    render: v => React.createElement("span", {
      className: "mono"
    }, v)
  }, {
    title: "调出仓",
    dataIndex: "from",
    width: 140
  }, {
    title: "调入仓",
    dataIndex: "to",
    width: 140
  }, {
    title: "SKU",
    dataIndex: "sku",
    width: 110,
    render: v => React.createElement("span", {
      className: "mono"
    }, v)
  }, {
    title: "商品",
    dataIndex: "name",
    width: 170
  }, {
    title: "数量",
    dataIndex: "qty",
    width: 70
  }, {
    title: "状态",
    dataIndex: "status",
    width: 90,
    render: v => React.createElement(Tag, {
      color: v === "received" ? "green" : "blue"
    }, v)
  }, {
    title: "操作人",
    dataIndex: "operator",
    width: 90
  }];
  return React.createElement("div", null, React.createElement(Alert, {
    type: "info",
    showIcon: true,
    style: {
      marginBottom: 12
    },
    message: "仓内作业：库位与批次效期 → 波次拣货（摘果式/播种式）→ 验货称重（按实重重算运费）→ 盘点（明盘/暗盘，差异自动生成损益）→ 库内调拨。"
  }), React.createElement(Tabs, {
    activeKey: tab,
    onChange: setTab,
    items: [{
      key: "1",
      label: `库位（${locs.length}）`,
      children: React.createElement(Table, {
        rowKey: "id",
        size: "small",
        columns: lcols,
        dataSource: locs,
        pagination: {
          pageSize: 12
        }
      })
    }, {
      key: "2",
      label: `批次效期（${bs.length}）`,
      children: React.createElement("div", null, React.createElement("div", {
        className: "dim",
        style: {
          marginBottom: 8
        }
      }, "按到期日升序，剩余不足 90 天标红；支持先进先出与临期预警"), React.createElement(Table, {
        rowKey: "id",
        size: "small",
        scroll: {
          x: 1250
        },
        columns: bcols,
        dataSource: bs,
        pagination: {
          pageSize: 12
        }
      }))
    }, {
      key: "3",
      label: `拣货波次（${waves.length}）`,
      children: React.createElement("div", null, React.createElement(Card, {
        size: "small",
        style: {
          marginBottom: 10
        }
      }, React.createElement(Space, {
        wrap: true
      }, React.createElement("span", null, "发货仓："), React.createElement(Select, {
        style: {
          width: 200
        },
        value: waveWh || whs[0] && whs[0].id || undefined,
        onChange: v => {
          setWaveWh(v);
          setSel([]);
        }
      }, whs.map(w => React.createElement(Option, {
        key: w.id,
        value: w.id
      }, w.name))), React.createElement("span", null, "已选 ", React.createElement("b", null, sel.length), " 单"), React.createElement(Button, {
        type: "primary",
        size: "small",
        disabled: !sel.length,
        onClick: async () => {
          const r = await post("/api/waves", {
            warehouse_id: waveWh || whs[0].id,
            order_ids: sel,
            strategy: "摘果式"
          });
          r.ok ? message.success(r.msg) : message.warning(r.msg);
          setSel([]);
          load();
        }
      }, "生成波次")), React.createElement("div", {
        className: "dim",
        style: {
          marginTop: 6
        }
      }, "波次把多笔订单聚合成一次拣货任务，按库位排序，减少仓内行走距离")), React.createElement(Table, {
        rowKey: "id",
        size: "small",
        scroll: {
          x: 1200
        },
        columns: wcols,
        dataSource: waves,
        pagination: false
      }), React.createElement(Divider, {
        plain: true
      }, "该仓待发货订单（勾选后生成波次）"), React.createElement(Table, {
        rowKey: "id",
        size: "small",
        pagination: {
          pageSize: 6
        },
        rowSelection: {
          selectedRowKeys: sel,
          onChange: setSel
        },
        dataSource: orders.filter(o => {
          const wid = waveWh || whs[0] && whs[0].id;
          return !wid || o.warehouse_id === wid;
        }),
        columns: [{
          title: "订单号",
          dataIndex: "order_no",
          width: 170,
          render: v => React.createElement("span", {
            className: "mono"
          }, v)
        }, {
          title: "店铺",
          dataIndex: "shop",
          width: 160
        }, {
          title: "收货地",
          render: (_, r) => `${r.province}${r.city}`
        }, {
          title: "金额",
          dataIndex: "amount",
          render: money
        }, {
          title: "发货仓",
          dataIndex: "warehouse"
        }]
      }))
    }, {
      key: "4",
      label: "波次拣货任务",
      children: React.createElement("div", null, React.createElement(Space, {
        style: {
          marginBottom: 10
        }
      }, React.createElement("span", null, "查看波次："), React.createElement(Select, {
        style: {
          width: 220
        },
        value: curWave || undefined,
        onChange: v => {
          setCurWave(v);
          api("/api/waves/" + v + "/tasks").then(setTasks);
        }
      }, waves.map(w => React.createElement(Option, {
        key: w.id,
        value: w.id
      }, `${w.wave_no}（${w.order_count}单/${w.qty_total}件）`))), React.createElement(Button, {
        size: "small",
        type: "primary",
        disabled: !curWave,
        onClick: async () => {
          const t0 = tasks[0];
          if (!t0) {
            message.warning("该波次暂无任务");
            return;
          }
          const r = await post(`/api/waves/${curWave}/pack`, {
            order_id: t0.order_id,
            weight_kg: 1.2
          });
          message.success(r.msg);
          load();
        }
      }, "验货称重（示例 1.2kg）")), React.createElement(Table, {
        rowKey: "id",
        size: "small",
        scroll: {
          x: 1000
        },
        columns: tcols,
        dataSource: tasks,
        pagination: {
          pageSize: 15
        }
      }))
    }, {
      key: "5",
      label: `验货打包（${packs.length}）`,
      children: React.createElement(Table, {
        rowKey: "id",
        size: "small",
        scroll: {
          x: 1000
        },
        columns: pcols,
        dataSource: packs,
        pagination: {
          pageSize: 12
        }
      })
    }, {
      key: "6",
      label: `盘点（${sts.length}）`,
      children: React.createElement("div", null, React.createElement(Space, {
        style: {
          marginBottom: 10
        }
      }, React.createElement(Button, {
        type: "primary",
        size: "small",
        onClick: () => setNewSt({
          warehouse_id: whs[0] && whs[0].id,
          mode: "明盘",
          limit: 12
        })
      }, "+ 新建盘点单")), React.createElement(Table, {
        rowKey: "id",
        size: "small",
        scroll: {
          x: 1100
        },
        columns: stcols,
        dataSource: sts,
        pagination: false
      }))
    }, {
      key: "7",
      label: `调拨（${tfs.length}）`,
      children: React.createElement("div", null, React.createElement(Space, {
        style: {
          marginBottom: 10
        }
      }, React.createElement(Button, {
        type: "primary",
        size: "small",
        onClick: () => setTf({
          from_warehouse_id: whs[0] && whs[0].id,
          to_warehouse_id: whs[1] && whs[1].id,
          product_id: prods[0] && prods[0].id,
          qty: 10
        })
      }, "+ 新建调拨")), React.createElement(Table, {
        rowKey: "id",
        size: "small",
        scroll: {
          x: 1150
        },
        columns: tfcols,
        dataSource: tfs,
        pagination: false
      }))
    }]
  }), stItems ? React.createElement(Drawer, {
    open: true,
    title: `盘点明细 ${stItems.st_no}（${stItems.mode}）`,
    width: 720,
    onClose: () => setStItems(null),
    extra: stItems.status !== "done" ? React.createElement(Button, {
      type: "primary",
      size: "small",
      onClick: async () => {
        await post(`/api/stocktakes/${stItems.items[0] ? "" : ""}`, {}).catch(() => {});
        message.info("提示：在页面中修改实盘数后，点列表的「提交盘点」生成损益");
      }
    }, "说明") : null
  }, React.createElement("div", null, React.createElement("div", {
    className: "dim",
    style: {
      marginBottom: 8
    }
  }, stItems.mode === "暗盘" ? "暗盘模式：实盘数不显示账面，避免盘点人作弊" : "明盘模式：显示账面数"), React.createElement(Table, {
    rowKey: "id",
    size: "small",
    pagination: false,
    dataSource: stItems.items,
    columns: [{
      title: "库位",
      dataIndex: "location_code",
      width: 100
    }, {
      title: "SKU",
      dataIndex: "sku",
      width: 110,
      render: v => React.createElement("span", {
        className: "mono"
      }, v)
    }, {
      title: "商品",
      dataIndex: "name",
      width: 170
    }, {
      title: "账面",
      dataIndex: "book_qty",
      width: 80
    }, {
      title: "实盘",
      dataIndex: "real_qty",
      width: 110,
      render: (v, r) => stItems.status === "done" ? v : React.createElement(InputNumber, {
        size: "small",
        value: v,
        min: 0,
        onChange: nv => {
          r.real_qty = nv;
          setStItems({
            ...stItems
          });
        }
      })
    }, {
      title: "差异",
      dataIndex: "diff",
      width: 80,
      render: v => React.createElement("b", {
        style: {
          color: v === 0 ? "#52c41a" : v > 0 ? "#1677ff" : "#f5222d"
        }
      }, v > 0 ? "+" + v : v)
    }, {
      title: "成本",
      dataIndex: "cost_price",
      width: 80,
      render: money
    }, {
      title: "损益",
      width: 100,
      render: (_, r) => money(r.diff * r.cost_price)
    }]
  }))) : null, React.createElement(Modal, {
    open: !!newSt,
    title: "新建盘点单",
    onCancel: () => setNewSt(null),
    onOk: async () => {
      const r = await post("/api/stocktakes", newSt);
      r.ok ? message.success(r.msg) : message.warning(r.msg);
      setNewSt(null);
      load();
    }
  }, newSt ? React.createElement(Form, {
    layout: "vertical"
  }, React.createElement(Form.Item, {
    label: "仓库"
  }, React.createElement(Select, {
    style: {
      width: "100%"
    },
    value: newSt.warehouse_id || undefined,
    onChange: v => setNewSt({
      ...newSt,
      warehouse_id: v
    })
  }, whs.map(w => React.createElement(Option, {
    key: w.id,
    value: w.id
  }, w.name)))), React.createElement(Form.Item, {
    label: "盘点方式"
  }, React.createElement(Select, {
    style: {
      width: "100%"
    },
    value: newSt.mode,
    onChange: v => setNewSt({
      ...newSt,
      mode: v
    })
  }, React.createElement(Option, {
    value: "明盘"
  }, "明盘（显示账面数）"), React.createElement(Option, {
    value: "暗盘"
  }, "暗盘（隐藏账面数）"))), React.createElement(Form.Item, {
    label: "盘点 SKU 数"
  }, React.createElement(InputNumber, {
    style: {
      width: "100%"
    },
    value: newSt.limit,
    onChange: v => setNewSt({
      ...newSt,
      limit: v
    })
  }))) : null), React.createElement(Modal, {
    open: !!tf,
    title: "新建库内调拨",
    onCancel: () => setTf(null),
    onOk: async () => {
      const r = await post("/api/transfers", tf);
      r.ok ? message.success(r.msg) : message.warning(r.msg);
      setTf(null);
      load();
    }
  }, tf ? React.createElement(Form, {
    layout: "vertical"
  }, React.createElement(Form.Item, {
    label: "调出仓"
  }, React.createElement(Select, {
    style: {
      width: "100%"
    },
    value: tf.from_warehouse_id || undefined,
    onChange: v => setTf({
      ...tf,
      from_warehouse_id: v
    })
  }, whs.map(w => React.createElement(Option, {
    key: w.id,
    value: w.id
  }, w.name)))), React.createElement(Form.Item, {
    label: "调入仓"
  }, React.createElement(Select, {
    style: {
      width: "100%"
    },
    value: tf.to_warehouse_id || undefined,
    onChange: v => setTf({
      ...tf,
      to_warehouse_id: v
    })
  }, whs.map(w => React.createElement(Option, {
    key: w.id,
    value: w.id
  }, w.name)))), React.createElement(Form.Item, {
    label: "商品"
  }, React.createElement(Select, {
    style: {
      width: "100%"
    },
    value: tf.product_id || undefined,
    onChange: v => setTf({
      ...tf,
      product_id: v
    })
  }, prods.map(p => React.createElement(Option, {
    key: p.id,
    value: p.id
  }, `${p.sku} ${p.name}`)))), React.createElement(Form.Item, {
    label: "数量"
  }, React.createElement(InputNumber, {
    style: {
      width: "100%"
    },
    value: tf.qty,
    onChange: v => setTf({
      ...tf,
      qty: v
    })
  }))) : null));
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
  useEffect(() => {
    load();
  }, [load]);
  const cols = [{
    title: "售后单号",
    dataIndex: "as_no",
    width: 160,
    render: (v, r) => React.createElement("a", {
      onClick: () => api("/api/after-sales/" + r.id).then(setDetail)
    }, React.createElement("span", {
      className: "mono"
    }, v))
  }, {
    title: "关联订单",
    dataIndex: "order_no",
    width: 170,
    render: v => React.createElement("span", {
      className: "mono"
    }, v)
  }, {
    title: "店铺",
    dataIndex: "shop",
    width: 160
  }, {
    title: "买家",
    dataIndex: "buyer_nick",
    width: 110
  }, {
    title: "类型",
    dataIndex: "atype_label",
    width: 100,
    render: (v, r) => React.createElement(Tag, {
      color: {
        refund: "orange",
        return: "blue",
        exchange: "purple",
        resend: "cyan",
        repair: "default"
      }[r.atype]
    }, v)
  }, {
    title: "原因",
    dataIndex: "reason",
    width: 130
  }, {
    title: "退款金额",
    dataIndex: "amount",
    width: 100,
    render: money
  }, {
    title: "状态",
    dataIndex: "status_label",
    width: 90,
    render: (v, r) => React.createElement(Tag, {
      color: {
        pending: "orange",
        approved: "blue",
        processing: "cyan",
        done: "green",
        rejected: "red"
      }[r.status]
    }, v)
  }, {
    title: "退回",
    width: 140,
    render: (_, r) => r.need_return ? React.createElement(Space, {
      size: 4
    }, React.createElement(Tag, {
      color: r.returned ? "green" : "default"
    }, r.returned ? "已退回" : "待退回"), r.restock ? React.createElement(Tag, {
      color: "blue"
    }, "已重新上架") : null) : React.createElement("span", {
      className: "dim"
    }, "无需退回")
  }, {
    title: "处理人",
    dataIndex: "handler",
    width: 90
  }, {
    title: "操作",
    width: 250,
    render: (_, r) => React.createElement(Space, {
      size: 4,
      wrap: true
    }, r.status === "pending" ? React.createElement(Button, {
      size: "small",
      type: "primary",
      onClick: async () => {
        const res = await post(`/api/after-sales/${r.id}/process?action=approve`);
        message.success(res.msg);
        load();
      }
    }, "同意") : null, r.status === "pending" ? React.createElement(Button, {
      size: "small",
      danger: true,
      onClick: async () => {
        const res = await post(`/api/after-sales/${r.id}/process?action=reject`);
        message.info(res.msg);
        load();
      }
    }, "拒绝") : null, r.status === "approved" && r.need_return && !r.returned ? React.createElement(Button, {
      size: "small",
      onClick: async () => {
        const res = await post(`/api/after-sales/${r.id}/process?action=return_received`);
        message.success(res.msg);
        load();
      }
    }, "退货入库") : null, ["approved", "processing"].indexOf(r.status) >= 0 ? React.createElement(Button, {
      size: "small",
      type: "primary",
      onClick: async () => {
        const res = await post(`/api/after-sales/${r.id}/process?action=done`);
        message.success(res.msg);
        load();
      }
    }, "完成退款") : null)
  }];
  return React.createElement("div", null, stats ? React.createElement(Row, {
    gutter: 12,
    style: {
      marginBottom: 12
    }
  }, React.createElement(Col, {
    span: 4
  }, React.createElement(Stat, {
    title: "售后单总数",
    value: stats.total
  })), React.createElement(Col, {
    span: 4
  }, React.createElement(Stat, {
    title: "待审核",
    value: stats.pending,
    color: "#fa8c16"
  })), React.createElement(Col, {
    span: 4
  }, React.createElement(Stat, {
    title: "已完成",
    value: stats.done,
    color: "#52c41a"
  })), React.createElement(Col, {
    span: 6
  }, React.createElement(Stat, {
    title: "退款总额",
    value: stats.amount,
    prefix: "¥",
    color: "#f5222d"
  })), React.createElement(Col, {
    span: 6
  }, React.createElement(Card, {
    size: "small",
    title: "按类型分布"
  }, React.createElement("div", null, Object.entries(stats.by_type).map(([k, v], i) => React.createElement("div", {
    key: i,
    style: {
      fontSize: 12,
      padding: "2px 0"
    }
  }, React.createElement("span", {
    className: "dim"
  }, k), "：", React.createElement("b", null, v), " 单")))))) : null, React.createElement(Card, {
    size: "small",
    style: {
      marginBottom: 12
    }
  }, React.createElement(Space, null, React.createElement(Button, {
    type: "primary",
    onClick: () => setAdd({
      order_id: orders[0] && orders[0].id,
      atype: "return",
      reason: "七天无理由"
    })
  }, "+ 新建售后单"), React.createElement("span", {
    className: "dim"
  }, "退货入库时，质检为「良品」的商品自动重新上架，次品不计入库存"))), React.createElement(Table, {
    rowKey: "id",
    size: "small",
    scroll: {
      x: 1600
    },
    columns: cols,
    dataSource: rows,
    pagination: {
      pageSize: 12
    }
  }), detail ? React.createElement(Drawer, {
    open: true,
    title: `售后明细 ${detail.as_no}`,
    width: 560,
    onClose: () => setDetail(null)
  }, React.createElement(Table, {
    rowKey: "sku",
    size: "small",
    pagination: false,
    dataSource: detail.items,
    columns: [{
      title: "SKU",
      dataIndex: "sku",
      render: v => React.createElement("span", {
        className: "mono"
      }, v)
    }, {
      title: "商品",
      dataIndex: "name"
    }, {
      title: "数量",
      dataIndex: "qty"
    }, {
      title: "单价",
      dataIndex: "price",
      render: money
    }, {
      title: "质检",
      dataIndex: "quality_label",
      render: (v, r) => React.createElement(Tag, {
        color: r.quality === "good" ? "green" : "red"
      }, v)
    }]
  })) : null, React.createElement(Modal, {
    open: !!add,
    title: "新建售后单",
    onCancel: () => setAdd(null),
    onOk: async () => {
      const r = await post("/api/after-sales", add);
      r.ok ? message.success(`售后单 ${r.as_no} 已创建`) : message.warning(r.msg);
      setAdd(null);
      load();
    }
  }, add ? React.createElement(Form, {
    layout: "vertical"
  }, React.createElement(Form.Item, {
    label: "关联订单（已发货）"
  }, React.createElement(Select, {
    style: {
      width: "100%"
    },
    value: add.order_id || undefined,
    onChange: v => setAdd({
      ...add,
      order_id: v
    })
  }, orders.map(o => React.createElement(Option, {
    key: o.id,
    value: o.id
  }, `${o.order_no} · ${o.shop}`)))), React.createElement(Form.Item, {
    label: "售后类型"
  }, React.createElement(Select, {
    style: {
      width: "100%"
    },
    value: add.atype,
    onChange: v => setAdd({
      ...add,
      atype: v
    })
  }, React.createElement(Option, {
    value: "refund"
  }, "仅退款"), React.createElement(Option, {
    value: "return"
  }, "退货退款"), React.createElement(Option, {
    value: "exchange"
  }, "换货"), React.createElement(Option, {
    value: "resend"
  }, "补发"), React.createElement(Option, {
    value: "repair"
  }, "维修"))), React.createElement(Form.Item, {
    label: "原因"
  }, React.createElement(Input, {
    value: add.reason,
    onChange: e => setAdd({
      ...add,
      reason: e.target.value
    })
  }))) : null));
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
  useEffect(() => {
    load();
  }, [load]);
  const bcols = [{
    title: "账单号",
    dataIndex: "bill_no",
    width: 180,
    render: (v, r) => React.createElement("a", {
      onClick: () => api("/api/bills/" + r.id + "/fees").then(setFees)
    }, React.createElement("span", {
      className: "mono"
    }, v))
  }, {
    title: "店铺",
    dataIndex: "shop",
    width: 170
  }, {
    title: "平台",
    dataIndex: "platform",
    width: 80,
    render: v => React.createElement(Tag, {
      color: "blue"
    }, v)
  }, {
    title: "账期",
    dataIndex: "period",
    width: 90
  }, {
    title: "订单金额",
    dataIndex: "order_amount",
    width: 100,
    render: money
  }, {
    title: "佣金",
    dataIndex: "commission",
    width: 80,
    render: money
  }, {
    title: "服务费",
    dataIndex: "service_fee",
    width: 80,
    render: money
  }, {
    title: "广告费",
    dataIndex: "ad_fee",
    width: 80,
    render: money
  }, {
    title: "退款",
    dataIndex: "refund_amount",
    width: 80,
    render: money
  }, {
    title: "运费",
    dataIndex: "freight_fee",
    width: 70,
    render: money
  }, {
    title: "应结算",
    dataIndex: "settle_amount",
    width: 100,
    render: v => React.createElement("b", {
      style: {
        color: "#52c41a"
      }
    }, money(v))
  }, {
    title: "费率",
    dataIndex: "fee_rate",
    width: 80,
    render: v => (v * 100).toFixed(2) + "%"
  }, {
    title: "状态",
    dataIndex: "status",
    width: 90,
    render: v => React.createElement(Tag, {
      color: {
        pending: "orange",
        reconciled: "blue",
        settled: "green"
      }[v]
    }, {
      pending: "待对账",
      reconciled: "已对账",
      settled: "已结算"
    }[v])
  }, {
    title: "操作",
    width: 90,
    render: (_, r) => React.createElement(Button, {
      size: "small",
      onClick: async () => {
        await post(`/api/bills/${r.id}/reconcile`);
        message.success("已对账");
        load();
      }
    }, "对账")
  }];
  const acols = [{
    title: "方向",
    dataIndex: "direction_label",
    width: 80,
    render: (v, r) => React.createElement(Tag, {
      color: r.direction === "ar" ? "green" : "orange"
    }, v)
  }, {
    title: "往来单位类型",
    dataIndex: "partner_type_label",
    width: 110
  }, {
    title: "往来单位",
    dataIndex: "partner_name",
    width: 190
  }, {
    title: "关联单号",
    dataIndex: "ref_no",
    width: 170,
    render: v => React.createElement("span", {
      className: "mono"
    }, v)
  }, {
    title: "金额",
    dataIndex: "amount",
    width: 100,
    render: money
  }, {
    title: "已结",
    dataIndex: "settled_amount",
    width: 90,
    render: money
  }, {
    title: "未结",
    dataIndex: "unsettled",
    width: 100,
    render: v => React.createElement("b", {
      style: {
        color: v > 0 ? "#f5222d" : "#52c41a"
      }
    }, money(v))
  }, {
    title: "状态",
    dataIndex: "status_label",
    width: 80,
    render: (v, r) => React.createElement(Tag, {
      color: {
        open: "red",
        partial: "orange",
        closed: "green"
      }[r.status]
    }, v)
  }, {
    title: "到期日",
    dataIndex: "due_date",
    width: 110
  }];
  const rcols = [{
    title: "订单号",
    dataIndex: "order_no",
    width: 170,
    render: v => React.createElement("span", {
      className: "mono"
    }, v)
  }, {
    title: "店铺",
    dataIndex: "shop",
    width: 170
  }, {
    title: "收入",
    dataIndex: "revenue",
    width: 90,
    render: money
  }, {
    title: "商品成本",
    dataIndex: "goods_cost",
    width: 90,
    render: money
  }, {
    title: "运费",
    dataIndex: "freight_cost",
    width: 70,
    render: money
  }, {
    title: "平台费",
    dataIndex: "platform_fee",
    width: 80,
    render: money
  }, {
    title: "广告分摊",
    dataIndex: "ad_fee",
    width: 90,
    render: money
  }, {
    title: "包材",
    dataIndex: "pack_cost",
    width: 70,
    render: money
  }, {
    title: "毛利",
    dataIndex: "gross_profit",
    width: 90,
    render: v => React.createElement("b", {
      style: {
        color: v >= 0 ? "#1677ff" : "#f5222d"
      }
    }, money(v))
  }, {
    title: "净利",
    dataIndex: "net_profit",
    width: 90,
    render: v => React.createElement("b", {
      style: {
        color: v >= 0 ? "#52c41a" : "#f5222d"
      }
    }, money(v))
  }, {
    title: "净利率",
    dataIndex: "margin",
    width: 80,
    render: v => React.createElement("b", {
      style: {
        color: v >= 0.2 ? "#52c41a" : "#fa8c16"
      }
    }, (v * 100).toFixed(1) + "%")
  }];
  const profitOpt = profit ? {
    tooltip: {
      trigger: "axis"
    },
    legend: {
      data: ["收入", "净利"],
      bottom: 0
    },
    grid: {
      left: 60,
      right: 30,
      top: 20,
      bottom: 40
    },
    xAxis: {
      type: "category",
      data: profit.rows.map(r => r.shop.slice(0, 6)),
      axisLabel: {
        fontSize: 10,
        interval: 0,
        rotate: 30
      }
    },
    yAxis: {
      type: "value"
    },
    series: [{
      name: "收入",
      type: "bar",
      data: profit.rows.map(r => r.revenue),
      itemStyle: {
        color: "#91caff"
      }
    }, {
      name: "净利",
      type: "bar",
      data: profit.rows.map(r => r.net),
      itemStyle: {
        color: "#52c41a"
      }
    }]
  } : null;
  return React.createElement("div", null, React.createElement(Alert, {
    type: "warning",
    showIcon: true,
    style: {
      marginBottom: 12
    },
    message: "利润口径必须统一：净利 = 收入 − 商品成本 − 运费 − 平台佣金/服务费 − 广告分摊 − 包材。只算毛利会把高流量低利润的店铺误判为优质店铺。"
  }), React.createElement(Tabs, {
    activeKey: tab,
    onChange: setTab,
    items: [{
      key: "1",
      label: `平台账单（${bills.length}）`,
      children: React.createElement("div", null, React.createElement(Space, {
        style: {
          marginBottom: 10
        },
        wrap: true
      }, React.createElement(Select, {
        style: {
          width: 220
        },
        placeholder: "选择店铺生成账单",
        onChange: async v => {
          const r = await post(`/api/bills/generate?shop_id=${v}`);
          r.ok ? message.success(r.msg) : message.warning(r.msg);
          load();
        }
      }, shops.map(s => React.createElement(Option, {
        key: s.id,
        value: s.id
      }, s.name)))), React.createElement(Table, {
        rowKey: "id",
        size: "small",
        scroll: {
          x: 1450
        },
        columns: bcols,
        dataSource: bills,
        pagination: false
      }), fees.length ? React.createElement(Card, {
        size: "small",
        title: "账单费用明细",
        style: {
          marginTop: 12
        }
      }, React.createElement(Table, {
        rowKey: "id",
        size: "small",
        pagination: false,
        dataSource: fees,
        columns: [{
          title: "费用类型",
          dataIndex: "fee_type"
        }, {
          title: "金额",
          dataIndex: "amount",
          render: money
        }, {
          title: "说明",
          dataIndex: "remark"
        }]
      })) : null)
    }, {
      key: "2",
      label: `应收应付（${apar.length}）`,
      children: React.createElement(Table, {
        rowKey: "id",
        size: "small",
        scroll: {
          x: 1150
        },
        columns: acols,
        dataSource: apar,
        pagination: {
          pageSize: 12
        }
      })
    }, {
      key: "3",
      label: "利润核算",
      children: React.createElement("div", null, React.createElement(Space, {
        style: {
          marginBottom: 10
        }
      }, React.createElement(Button, {
        type: "primary",
        size: "small",
        onClick: async () => {
          const r = await post("/api/profit/calc");
          message.success(r.msg);
          load();
        }
      }, "重新核算订单利润")), profit ? React.createElement("div", null, React.createElement(Row, {
        gutter: 12,
        style: {
          marginBottom: 12
        }
      }, React.createElement(Col, {
        span: 6
      }, React.createElement(Stat, {
        title: "核算店铺数",
        value: profit.count
      })), React.createElement(Col, {
        span: 6
      }, React.createElement(Stat, {
        title: "总收入",
        value: profit.total_revenue,
        prefix: "¥",
        color: "#1677ff"
      })), React.createElement(Col, {
        span: 6
      }, React.createElement(Stat, {
        title: "总净利",
        value: profit.total_net,
        prefix: "¥",
        color: "#52c41a"
      })), React.createElement(Col, {
        span: 6
      }, React.createElement(Stat, {
        title: "综合净利率",
        value: (profit.total_margin * 100).toFixed(1),
        suffix: "%",
        color: "#722ed1"
      }))), React.createElement(Card, {
        size: "small",
        title: "店铺收入 vs 净利",
        style: {
          marginBottom: 12
        }
      }, React.createElement(EChart, {
        option: profitOpt,
        height: 280
      })), React.createElement(Table, {
        rowKey: "shop",
        size: "small",
        scroll: {
          x: 1100
        },
        pagination: false,
        dataSource: profit.rows,
        columns: [{
          title: "店铺",
          dataIndex: "shop",
          width: 170
        }, {
          title: "平台",
          dataIndex: "platform",
          width: 80,
          render: v => React.createElement(Tag, {
            color: "blue"
          }, v)
        }, {
          title: "订单数",
          dataIndex: "orders",
          width: 80
        }, {
          title: "收入",
          dataIndex: "revenue",
          width: 100,
          render: money
        }, {
          title: "商品成本",
          dataIndex: "goods_cost",
          width: 100,
          render: money
        }, {
          title: "平台费",
          dataIndex: "platform_fee",
          width: 90,
          render: money
        }, {
          title: "广告费",
          dataIndex: "ad_fee",
          width: 90,
          render: money
        }, {
          title: "毛利",
          dataIndex: "gross",
          width: 90,
          render: money
        }, {
          title: "净利",
          dataIndex: "net",
          width: 90,
          render: v => React.createElement("b", {
            style: {
              color: v >= 0 ? "#52c41a" : "#f5222d"
            }
          }, money(v))
        }, {
          title: "净利率",
          dataIndex: "margin",
          width: 90,
          render: v => React.createElement("b", {
            style: {
              color: v >= 0.2 ? "#52c41a" : "#fa8c16"
            }
          }, (v * 100).toFixed(1) + "%")
        }]
      })) : React.createElement(Empty, {
        description: "暂无利润数据，点击上方按钮核算"
      }))
    }, {
      key: "4",
      label: `订单利润明细（${records.length}）`,
      children: React.createElement(Table, {
        rowKey: "id",
        size: "small",
        scroll: {
          x: 1250
        },
        columns: rcols,
        dataSource: records,
        pagination: {
          pageSize: 12
        }
      })
    }]
  }));
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
    tooltip: {
      trigger: "item"
    },
    legend: {
      bottom: 0
    },
    series: [{
      type: "pie",
      radius: ["40%", "66%"],
      data: sales.by_platform.map(r => ({
        name: r.name,
        value: r.amount
      }))
    }]
  } : null;
  const catOpt = sales ? {
    tooltip: {
      trigger: "axis"
    },
    grid: {
      left: 60,
      right: 30,
      top: 20,
      bottom: 30
    },
    xAxis: {
      type: "category",
      data: sales.by_category.map(r => r.name)
    },
    yAxis: {
      type: "value"
    },
    series: [{
      type: "bar",
      data: sales.by_category.map(r => r.amount),
      itemStyle: {
        color: "#1677ff"
      }
    }, {
      type: "line",
      data: sales.by_category.map(r => r.qty),
      yAxisIndex: 0
    }]
  } : null;
  const stOpt = inv ? {
    tooltip: {
      trigger: "item"
    },
    legend: {
      bottom: 0
    },
    series: [{
      type: "pie",
      radius: ["40%", "66%"],
      data: [{
        name: "正常",
        value: inv.rows.filter(r => r.status === "正常").length
      }, {
        name: "缺货",
        value: inv.short
      }, {
        name: "呆滞",
        value: inv.slow
      }],
      color: ["#52c41a", "#f5222d", "#faad14"]
    }]
  } : null;
  return React.createElement("div", null, React.createElement(Tabs, {
    activeKey: tab,
    onChange: setTab,
    items: [{
      key: "1",
      label: "销售报表",
      children: sales ? React.createElement("div", null, React.createElement(Row, {
        gutter: 12
      }, React.createElement(Col, {
        span: 10
      }, React.createElement(Card, {
        size: "small",
        title: "平台销售额占比"
      }, React.createElement(EChart, {
        option: platOpt,
        height: 260
      }))), React.createElement(Col, {
        span: 14
      }, React.createElement(Card, {
        size: "small",
        title: "品类销售额与销量"
      }, React.createElement(EChart, {
        option: catOpt,
        height: 260
      })))), React.createElement(Card, {
        size: "small",
        title: "SKU 销售排行 TOP15",
        style: {
          marginTop: 12
        }
      }, React.createElement(Table, {
        rowKey: "sku",
        size: "small",
        pagination: false,
        dataSource: sales.sku_top,
        columns: [{
          title: "SKU",
          dataIndex: "sku",
          width: 130,
          render: v => React.createElement("span", {
            className: "mono"
          }, v)
        }, {
          title: "商品",
          dataIndex: "name",
          width: 220
        }, {
          title: "销量",
          dataIndex: "qty",
          width: 90
        }, {
          title: "销售额",
          dataIndex: "amount",
          width: 110,
          render: money
        }]
      }))) : React.createElement("div", {
        className: "loading"
      }, "加载中…")
    }, {
      key: "2",
      label: "库存报表",
      children: inv ? React.createElement("div", null, React.createElement(Row, {
        gutter: 12,
        style: {
          marginBottom: 12
        }
      }, React.createElement(Col, {
        span: 6
      }, React.createElement(Stat, {
        title: "库存总值",
        value: inv.total_value,
        prefix: "¥",
        color: "#1677ff"
      })), React.createElement(Col, {
        span: 6
      }, React.createElement(Stat, {
        title: "呆滞 SKU",
        value: inv.slow,
        color: "#faad14"
      })), React.createElement(Col, {
        span: 6
      }, React.createElement(Stat, {
        title: "缺货 SKU",
        value: inv.short,
        color: "#f5222d"
      })), React.createElement(Col, {
        span: 6
      }, React.createElement(Card, {
        size: "small",
        title: "库存健康度"
      }, React.createElement(EChart, {
        option: stOpt,
        height: 150
      })))), React.createElement(Table, {
        rowKey: "sku",
        size: "small",
        scroll: {
          x: 1150
        },
        pagination: {
          pageSize: 12
        },
        dataSource: inv.rows,
        columns: [{
          title: "SKU",
          dataIndex: "sku",
          width: 120,
          render: v => React.createElement("span", {
            className: "mono"
          }, v)
        }, {
          title: "商品",
          dataIndex: "name",
          width: 190
        }, {
          title: "分类",
          dataIndex: "category",
          width: 90
        }, {
          title: "实物",
          dataIndex: "on_hand",
          width: 70
        }, {
          title: "可用",
          dataIndex: "available",
          width: 70
        }, {
          title: "锁定",
          dataIndex: "locked",
          width: 70
        }, {
          title: "累计销量",
          dataIndex: "sold",
          width: 90
        }, {
          title: "周转率",
          dataIndex: "turnover",
          width: 80
        }, {
          title: "可售天数",
          dataIndex: "cover_days",
          width: 90,
          render: v => v >= 999 ? "∞" : v
        }, {
          title: "库存金额",
          dataIndex: "value",
          width: 100,
          render: money
        }, {
          title: "状态",
          dataIndex: "status",
          width: 80,
          render: v => React.createElement(Tag, {
            color: {
              "正常": "green",
              "缺货": "red",
              "呆滞": "orange"
            }[v]
          }, v)
        }]
      })) : React.createElement("div", {
        className: "loading"
      }, "加载中…")
    }, {
      key: "3",
      label: "履约效率",
      children: ful ? React.createElement("div", null, React.createElement(Row, {
        gutter: 12,
        style: {
          marginBottom: 12
        }
      }, React.createElement(Col, {
        span: 6
      }, React.createElement(Stat, {
        title: "已发货订单",
        value: ful.shipped_count,
        color: "#52c41a"
      })), React.createElement(Col, {
        span: 6
      }, React.createElement(Stat, {
        title: "平均审单时长",
        value: ful.avg_audit_min,
        suffix: "分钟",
        color: "#1677ff"
      })), React.createElement(Col, {
        span: 6
      }, React.createElement(Stat, {
        title: "平均发货时长",
        value: ful.avg_ship_hour,
        suffix: "小时",
        color: "#722ed1"
      })), React.createElement(Col, {
        span: 6
      }, React.createElement(Stat, {
        title: "拦截率",
        value: (ful.intercept_rate * 100).toFixed(1),
        suffix: "%",
        color: "#f5222d"
      }))), React.createElement(Row, {
        gutter: 12
      }, React.createElement(Col, {
        span: 12
      }, React.createElement(Card, {
        size: "small",
        title: "订单状态分布"
      }, React.createElement(Table, {
        rowKey: "k",
        size: "small",
        pagination: false,
        dataSource: Object.entries(ful.by_status).map(([k, v]) => ({
          k,
          v
        })),
        columns: [{
          title: "状态",
          dataIndex: "k",
          render: v => React.createElement(Tag, {
            color: STATUS_COLOR[v]
          }, STATUS_LABEL_C[v] || v)
        }, {
          title: "订单数",
          dataIndex: "v"
        }, {
          title: "占比",
          render: (_, r) => (r.v / ful.total_orders * 100).toFixed(1) + "%"
        }]
      }))), React.createElement(Col, {
        span: 12
      }, React.createElement(Card, {
        size: "small",
        title: "仓内作业"
      }, React.createElement(Descriptions, {
        bordered: true,
        size: "small",
        column: 1
      }, React.createElement(Descriptions.Item, {
        label: "拣货波次总数"
      }, ful.wave_count), React.createElement(Descriptions.Item, {
        label: "已完成波次"
      }, ful.wave_done), React.createElement(Descriptions.Item, {
        label: "盘点单数量"
      }, ful.stocktake_count), React.createElement(Descriptions.Item, {
        label: "订单总量"
      }, ful.total_orders)))))) : React.createElement("div", {
        className: "loading"
      }, "加载中…")
    }, {
      key: "4",
      label: "经营日报",
      children: daily ? React.createElement("div", null, React.createElement(Row, {
        gutter: 12
      }, React.createElement(Col, {
        span: 8
      }, React.createElement(Card, {
        size: "small",
        title: "今日订单"
      }, React.createElement(Statistic, {
        value: daily.today.orders,
        valueStyle: {
          fontSize: 30,
          color: "#1677ff"
        }
      }), React.createElement("div", {
        className: "dim"
      }, "较昨日 ", React.createElement("b", {
        style: {
          color: daily.delta_orders >= 0 ? "#52c41a" : "#f5222d"
        }
      }, daily.delta_orders >= 0 ? "+" + daily.delta_orders : daily.delta_orders)))), React.createElement(Col, {
        span: 8
      }, React.createElement(Card, {
        size: "small",
        title: "今日销售额"
      }, React.createElement(Statistic, {
        value: daily.today.amount,
        prefix: "¥",
        valueStyle: {
          fontSize: 30,
          color: "#52c41a"
        }
      }), React.createElement("div", {
        className: "dim"
      }, "较昨日 ", React.createElement("b", {
        style: {
          color: daily.delta_amount >= 0 ? "#52c41a" : "#f5222d"
        }
      }, (daily.delta_amount >= 0 ? "+" : "") + daily.delta_amount.toFixed(2))))), React.createElement(Col, {
        span: 8
      }, React.createElement(Card, {
        size: "small",
        title: "今日已发货"
      }, React.createElement(Statistic, {
        value: daily.today.shipped,
        valueStyle: {
          fontSize: 30,
          color: "#722ed1"
        }
      }), React.createElement("div", {
        className: "dim"
      }, "昨日发货 ", daily.yesterday.shipped)))), React.createElement(Alert, {
        type: "info",
        showIcon: true,
        style: {
          marginTop: 12
        },
        message: "经营日报应支持定时推送到企微/钉钉/邮件，并可保存为团队模板；2.0 版本将补齐周报、月报与自定义报表配置。"
      })) : React.createElement("div", {
        className: "loading"
      }, "加载中…")
    }]
  }));
}
const STATUS_LABEL_C = {
  pending: "待审单",
  auditing: "挂起待处理",
  waiting: "待发货",
  shipped: "已发货",
  intercepted: "已拦截",
  cancelled: "已取消",
  merged: "已合并"
};

/* ============ 重新组装页面与路由 ============ */
const PAGES = BASE_PAGES.concat([{
  key: "purchase",
  label: "采购供应链",
  comp: Purchase
}, {
  key: "wms",
  label: "仓储作业",
  comp: Wms
}, {
  key: "aftersale",
  label: "售后工单",
  comp: AfterSales
}, {
  key: "finance",
  label: "财务对账",
  comp: Finance
}, {
  key: "reports",
  label: "报表中心",
  comp: Reports
}]);
function App() {
  const [cur, setCur] = useState((location.hash || "#dashboard").slice(1));
  useEffect(() => {
    const h = () => setCur((location.hash || "#dashboard").slice(1));
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, []);
  const page = PAGES.find(p => p.key === cur) || PAGES[0];
  return React.createElement(Layout, {
    style: {
      minHeight: "100vh"
    }
  }, React.createElement(Header, {
    className: "app-header"
  }, React.createElement("div", {
    className: "logo"
  }, React.createElement("span", {
    className: "cn"
  }, "塔奥"), React.createElement("span", {
    className: "en"
  }, "thalvior")), React.createElement("span", {
    className: "sub"
  }, "多平台 · 多店铺统一管理中枢"), React.createElement("div", {
    className: "header-right"
  }, React.createElement(Tag, {
    color: "green"
  }, "12 店铺已授权"), React.createElement(Tag, {
    color: "blue"
  }, "8 平台"), React.createElement(Tag, {
    color: "purple"
  }, "3 仓"), React.createElement("span", {
    className: "user"
  }, "admin · 超级管理员"))), React.createElement(Layout, null, React.createElement(Sider, {
    width: 168,
    theme: "light",
    className: "app-sider"
  }, React.createElement(Menu, {
    mode: "inline",
    selectedKeys: [page.key],
    style: {
      borderRight: 0
    },
    onClick: e => {
      location.hash = "#" + e.key;
    },
    items: PAGES.map(p => ({
      key: p.key,
      label: p.label
    }))
  })), React.createElement(Content, {
    className: "app-content"
  }, React.createElement(page.comp, {
    key: page.key
  }))));
}
ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));
//# sourceURL=app.jsx
