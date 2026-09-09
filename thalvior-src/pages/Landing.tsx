// thalvior 官网落地页（文案已调整为真实、可验证的表述）
import BrandLogo from '../components/BrandLogo';
import { Link, useNavigate } from 'react-router-dom';
import {
  ShoppingOutlined,
  ThunderboltOutlined,
  GlobalOutlined,
  SafetyOutlined,
  BarChartOutlined,
  RocketOutlined,
  ApiOutlined,
  CustomerServiceOutlined,
  TeamOutlined,
  GiftOutlined,
  CheckCircleOutlined,
  ArrowRightOutlined,
  CodeOutlined,
  DatabaseOutlined,
  CloudOutlined,
  CreditCardOutlined,
  FileTextOutlined,
  RobotOutlined,
  CheckOutlined,
} from '@ant-design/icons';

const FEATURES = [
  {
    icon: <ShoppingOutlined />,
    title: '多平台订单统一管理',
    desc: '一站接入抖店 / 快手 / 视频号 / 淘宝 / 京东 / 拼多多 / Shopify / Amazon 等主流电商平台，订单自动归集，告别切换后台。',
    color: '#1677ff',
  },
  {
    icon: <ThunderboltOutlined />,
    title: '智能审单 + 自动化规则',
    desc: '可视化配置触发条件，自动审单 / 自动分仓 / 自动短信 / 自动改价，减少重复性人工操作。',
    color: '#fa8c16',
  },
  {
    icon: <DatabaseOutlined />,
    title: '库存原子操作 / 防超卖',
    desc: '下单即锁定库存，原子化扣减与回滚，有效降低大促期间的超卖风险。',
    color: '#52c41a',
  },
  {
    icon: <BarChartOutlined />,
    title: 'BI 数据看板',
    desc: '销售漏斗 / 商品 TOP / RFM 客户分层 / 时段分析 / 库存周转 / 地理分布，多维度洞察业务。',
    color: '#722ed1',
  },
  {
    icon: <GlobalOutlined />,
    title: '多币种与汇率换算',
    desc: '支持多币种结算与实时汇率换算，出海更便利。',
    color: '#13c2c2',
  },
  {
    icon: <SafetyOutlined />,
    title: '多租户隔离 / 审计日志',
    desc: '完善的数据隔离机制，操作全留痕，满足企业合规审计要求。',
    color: '#eb2f96',
  },
  {
    icon: <GiftOutlined />,
    title: '优惠券 / 满减营销',
    desc: '满减 / 折扣 / 免邮多类型，多档位促销，原子化核销与退款回滚，营销活动得心应手。',
    color: '#f5222d',
  },
  {
    icon: <FileTextOutlined />,
    title: '多级审批工作流',
    desc: '可视化配置审批节点 (按角色 / 按用户 / 自动)，顺序审批 / 任一审批，节点条件路由。',
    color: '#2f54eb',
  },
  {
    icon: <RobotOutlined />,
    title: '帮助中心与在线客服',
    desc: '内置业务知识库，订单 / 商品 / 库存 / 计费 / 财务 全部覆盖，即问即答。',
    color: '#a0d911',
  },
  {
    icon: <ApiOutlined />,
    title: 'Webhook + 定时任务',
    desc: '对接 ERP / WMS / 财务系统，灵活的事件触发与定时执行，系统集成无门槛。',
    color: '#fa541c',
  },
  {
    icon: <CustomerServiceOutlined />,
    title: 'PDA 扫码发货',
    desc: '移动端 PDA 扫码，订单/快递号一码搞定，提升仓库拣货发货效率。',
    color: '#1890ff',
  },
  {
    icon: <CreditCardOutlined />,
    title: '计费 / 订阅 / 发票',
    desc: '免费版 / 基础版 / 专业版 / 企业版多档套餐，在线申请发票，邀请分销返佣。',
    color: '#faad14',
  },
];

const STATS = [
  { num: '多平台', label: '订单归集' },
  { num: '自动化', label: '规则引擎' },
  { num: '可视化', label: '数据看板' },
  { num: '多租户', label: '权限隔离' },
];

const PLATFORMS = [
  '抖店', '快手电商', '视频号', '淘宝', '天猫', '京东', '拼多多', '小红书',
  'Shopify', 'Amazon', 'eBay', 'Lazada', 'Shopee', 'TikTok Shop', 'AliExpress',
  '美团', '饿了么', '有赞', '微店', '唯品会', '得物', '小米有品',
];

const PRICING = [
  {
    name: '免费版',
    price: '0',
    period: '永久免费',
    desc: '适合个人卖家 / 小团队试水',
    features: ['1 个店铺绑定', '日 100 单处理', '基础订单/商品管理', '社区支持'],
    cta: '免费使用',
    highlight: false,
  },
  {
    name: '基础版',
    price: '299',
    period: '元/月',
    desc: '适合成长型电商团队',
    features: ['5 个店铺绑定', '日 3000 单处理', '完整订单/库存/财务', 'BI 基础看板', '邮件工单支持'],
    cta: '立即开通',
    highlight: false,
  },
  {
    name: '专业版',
    price: '999',
    period: '元/月',
    desc: '适合中大型卖家',
    features: ['20 个店铺绑定', '不限单量', '完整 BI + 实时大屏', '规则引擎 + 工作流', 'API + Webhook', '一对一客服'],
    cta: '立即开通',
    highlight: true,
  },
  {
    name: '企业版',
    price: '面议',
    period: '定制报价',
    desc: '适合品牌商 / 代运营公司',
    features: ['不限店铺 / 不限单量', '专属部署 / 私有化', '多租户子公司管理', '定制开发', '专属服务支持', '客户成功经理'],
    cta: '联系销售',
    highlight: false,
  },
];

const FAQS = [
  {
    q: '支持哪些电商平台?',
    a: '已对接国内外主流平台，包括抖店 / 快手 / 视频号 / 淘宝 / 京东 / 拼多多 / Shopify / Amazon / eBay / Lazada / Shopee / TikTok Shop 等。持续增加中。',
  },
  {
    q: '数据安全吗?',
    a: '采用多租户隔离架构，操作全程留痕，数据加密存储，支持私有化部署。企业版可享受专属服务器与服务支持。',
  },
  {
    q: '可以试用吗?',
    a: '注册即送 14 天专业版试用，无需信用卡。试用期内可体验全部高级功能，试用结束后自动降级为免费版。',
  },
  {
    q: '如何收费?',
    a: '按店铺数和单量阶梯收费，无任何隐藏费用。月付 / 季付 / 年付可选，年付享优惠。企业版支持定制。',
  },
  {
    q: '支持 API 对接吗?',
    a: '完整 OpenAPI，配套 Webhook 事件回调，文档详尽。支持 ERP / WMS / 财务系统集成。',
  },
  {
    q: '如何获得技术支持?',
    a: '免费版社区支持；基础版邮件工单；专业版一对一客服 (工作日 9-18)；企业版专属客户成功经理。',
  },
];

const STEPS = [
  {
    num: '01',
    title: '注册账号',
    desc: '创建租户，自动获得默认角色与权限。',
    icon: <TeamOutlined />,
  },
  {
    num: '02',
    title: '绑定店铺',
    desc: '一键授权 / API Key / 扫码三种方式，快速接入。',
    icon: <ApiOutlined />,
  },
  {
    num: '03',
    title: '配置自动化',
    desc: '拖拽式配置规则引擎与审批流，业务自动化运转。',
    icon: <RocketOutlined />,
  },
  {
    num: '04',
    title: '洞察数据',
    desc: 'BI 看板 + 实时大屏，业务状况尽在掌握。',
    icon: <BarChartOutlined />,
  },
];

export default function LandingPage() {
  const nav = useNavigate();

  return (
    <div style={{ background: '#fff', color: 'rgba(0,0,0,0.88)', overflowX: 'hidden' }}>
      {/* ====== 顶部导航 ====== */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 100,
          background: 'rgba(255,255,255,0.85)',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid #f0f0f0',
          padding: '14px 0',
        }}
      >
        <div
          style={{
            maxWidth: 1200,
            margin: '0 auto',
            padding: '0 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          >
            <BrandLogo size={36} color="#1D2129" />
            <div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>thalvior</div>
              <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>跨境电商一体化平台</div>
            </div>
          </div>
          <nav style={{ display: 'flex', gap: 32, alignItems: 'center' }}>
            <a href="#features" style={navLinkStyle}>产品功能</a>
            <a href="#how" style={navLinkStyle}>如何使用</a>
            <a href="#pricing" style={navLinkStyle}>套餐价格</a>
            <a href="#faq" style={navLinkStyle}>常见问题</a>
          </nav>
          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={() => nav('/login')} style={btnGhost}>登录</button>
            <button onClick={() => nav('/register')} style={btnPrimary}>
              免费注册 <ArrowRightOutlined />
            </button>
          </div>
        </div>
      </header>

      {/* ====== Hero ====== */}
      <section
        style={{
          padding: '100px 24px 80px',
          textAlign: 'center',
          background: 'radial-gradient(ellipse at 50% 0%, #e6f4ff 0%, transparent 60%)',
        }}
      >
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 12px',
              borderRadius: 999,
              background: 'rgba(22,119,255,0.08)',
              color: '#1677ff',
              fontSize: 13,
              marginBottom: 24,
            }}
          >
            <CheckCircleOutlined /> 数据安全与隐私保护
          </div>
          <h1
            style={{
              fontSize: 56,
              fontWeight: 800,
              lineHeight: 1.2,
              margin: '0 0 20px',
              background: 'linear-gradient(135deg, #1677ff 0%, #722ed1 50%, #eb2f96 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            跨境电商一体化
            <br />
            让出海更简单
          </h1>
          <p
            style={{
              fontSize: 20,
              color: 'rgba(0,0,0,0.65)',
              maxWidth: 720,
              margin: '0 auto 40px',
              lineHeight: 1.7,
            }}
          >
            一站接入主流电商平台，订单 / 商品 / 库存 / 财务 / 物流全流程自动化。
            智能审单、防超卖、实时 BI 大屏，让你的电商业务获得更高效的运营体验。
          </p>
          <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginBottom: 48 }}>
            <button onClick={() => nav('/register')} style={btnPrimaryLg}>
              免费试用 14 天 <ArrowRightOutlined />
            </button>
            <a href="#features" style={btnGhostLg}>
              了解更多
            </a>
          </div>

          {/* 统计 */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 24,
              maxWidth: 720,
              margin: '0 auto',
            }}
          >
            {STATS.map((s, i) => (
              <div key={i}>
                <div
                  style={{
                    fontSize: 28,
                    fontWeight: 700,
                    color: '#1677ff',
                  }}
                >
                  {s.num}
                </div>
                <div style={{ color: 'rgba(0,0,0,0.55)', fontSize: 14 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ====== 已对接平台 ====== */}
      <section style={{ padding: '40px 24px', background: '#fafafa' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', textAlign: 'center' }}>
          <div style={{ color: 'rgba(0,0,0,0.45)', fontSize: 14, marginBottom: 20, letterSpacing: 2 }}>
            已对接国内外主流电商平台
          </div>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              gap: 12,
            }}
          >
            {PLATFORMS.map((p) => (
              <div
                key={p}
                style={{
                  padding: '8px 18px',
                  background: '#fff',
                  border: '1px solid #f0f0f0',
                  borderRadius: 999,
                  fontSize: 14,
                  color: 'rgba(0,0,0,0.75)',
                }}
              >
                {p}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ====== 核心功能 ====== */}
      <section id="features" style={{ padding: '100px 24px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 60 }}>
            <div
              style={{
                display: 'inline-block',
                padding: '4px 12px',
                background: 'rgba(22,119,255,0.08)',
                color: '#1677ff',
                borderRadius: 999,
                fontSize: 13,
                marginBottom: 16,
              }}
            >
              核心功能
            </div>
            <h2 style={{ fontSize: 40, fontWeight: 700, margin: '0 0 16px' }}>
              一个平台，解决所有电商运营难题
            </h2>
            <p style={{ fontSize: 16, color: 'rgba(0,0,0,0.55)', maxWidth: 600, margin: '0 auto' }}>
              从订单到发货，从库存到财务，从规则到 BI，我们提供完整的电商 ERP 解决方案。
            </p>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: 24,
            }}
          >
            {FEATURES.map((f, i) => (
              <div
                key={i}
                style={{
                  padding: 28,
                  background: '#fff',
                  border: '1px solid #f0f0f0',
                  borderRadius: 12,
                  transition: 'all 0.2s',
                  cursor: 'default',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-4px)';
                  e.currentTarget.style.boxShadow = '0 12px 32px rgba(0,0,0,0.08)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 10,
                    background: `${f.color}15`,
                    color: f.color,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 22,
                    marginBottom: 16,
                  }}
                >
                  {f.icon}
                </div>
                <h3 style={{ fontSize: 17, fontWeight: 600, margin: '0 0 8px' }}>{f.title}</h3>
                <p style={{ fontSize: 14, color: 'rgba(0,0,0,0.6)', lineHeight: 1.7, margin: 0 }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ====== 如何使用 ====== */}
      <section
        id="how"
        style={{
          padding: '100px 24px',
          background: 'linear-gradient(180deg, #fafafa 0%, #fff 100%)',
        }}
      >
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 60 }}>
            <div
              style={{
                display: 'inline-block',
                padding: '4px 12px',
                background: 'rgba(114,46,209,0.08)',
                color: '#722ed1',
                borderRadius: 999,
                fontSize: 13,
                marginBottom: 16,
              }}
            >
              如何使用
            </div>
            <h2 style={{ fontSize: 40, fontWeight: 700, margin: 0 }}>4 步开启电商自动化</h2>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: 32,
            }}
          >
            {STEPS.map((s, i) => (
              <div
                key={i}
                style={{
                  padding: 32,
                  background: '#fff',
                  borderRadius: 12,
                  border: '1px solid #f0f0f0',
                  position: 'relative',
                }}
              >
                <div
                  style={{
                    fontSize: 56,
                    fontWeight: 800,
                    color: 'rgba(22,119,255,0.1)',
                    position: 'absolute',
                    top: 16,
                    right: 16,
                    lineHeight: 1,
                  }}
                >
                  {s.num}
                </div>
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 24,
                    background: 'linear-gradient(135deg, #1677ff, #722ed1)',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 22,
                    marginBottom: 16,
                  }}
                >
                  {s.icon}
                </div>
                <h3 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 8px' }}>{s.title}</h3>
                <p style={{ fontSize: 14, color: 'rgba(0,0,0,0.6)', lineHeight: 1.7, margin: 0 }}>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ====== 套餐价格 ====== */}
      <section id="pricing" style={{ padding: '100px 24px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 60 }}>
            <div
              style={{
                display: 'inline-block',
                padding: '4px 12px',
                background: 'rgba(245,34,45,0.08)',
                color: '#f5222d',
                borderRadius: 999,
                fontSize: 13,
                marginBottom: 16,
              }}
            >
              套餐价格
            </div>
            <h2 style={{ fontSize: 40, fontWeight: 700, margin: '0 0 16px' }}>选择适合你的套餐</h2>
            <p style={{ fontSize: 16, color: 'rgba(0,0,0,0.55)' }}>
              年付享优惠，14 天免费试用，随时升级降级
            </p>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: 24,
            }}
          >
            {PRICING.map((p, i) => (
              <div
                key={i}
                style={{
                  padding: 32,
                  background: p.highlight ? 'linear-gradient(180deg, #1677ff 0%, #4096ff 100%)' : '#fff',
                  color: p.highlight ? '#fff' : 'rgba(0,0,0,0.88)',
                  borderRadius: 16,
                  border: p.highlight ? 'none' : '1px solid #f0f0f0',
                  position: 'relative',
                  boxShadow: p.highlight ? '0 20px 40px rgba(22,119,255,0.25)' : 'none',
                }}
              >
                {p.highlight && (
                  <div
                    style={{
                      position: 'absolute',
                      top: -12,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      padding: '4px 14px',
                      background: '#fa8c16',
                      color: '#fff',
                      fontSize: 12,
                      borderRadius: 999,
                      fontWeight: 600,
                    }}
                  >
                    最受欢迎
                  </div>
                )}
                <h3 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 8px' }}>{p.name}</h3>
                <p
                  style={{
                    fontSize: 13,
                    color: p.highlight ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.55)',
                    margin: '0 0 20px',
                  }}
                >
                  {p.desc}
                </p>
                <div style={{ marginBottom: 24 }}>
                  <span style={{ fontSize: 40, fontWeight: 700 }}>¥{p.price}</span>
                  <span
                    style={{
                      fontSize: 14,
                      marginLeft: 4,
                      color: p.highlight ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.55)',
                    }}
                  >
                    / {p.period}
                  </span>
                </div>
                <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 24px' }}>
                  {p.features.map((f, j) => (
                    <li
                      key={j}
                      style={{
                        padding: '8px 0',
                        fontSize: 14,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                      }}
                    >
                      <CheckOutlined
                        style={{ color: p.highlight ? '#fff' : '#52c41a' }}
                      />
                      {f}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => nav('/register')}
                  style={
                    p.highlight
                      ? { ...btnPrimaryLg, background: '#fff', color: '#1677ff' }
                      : btnPrimaryLg
                  }
                >
                  {p.cta}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ====== 常见问题 ====== */}
      <section id="faq" style={{ padding: '100px 24px', background: '#fafafa' }}>
        <div style={{ maxWidth: 800, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 60 }}>
            <div
              style={{
                display: 'inline-block',
                padding: '4px 12px',
                background: 'rgba(82,196,26,0.08)',
                color: '#52c41a',
                borderRadius: 999,
                fontSize: 13,
                marginBottom: 16,
              }}
            >
              常见问题
            </div>
            <h2 style={{ fontSize: 40, fontWeight: 700, margin: 0 }}>你可能想了解的</h2>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {FAQS.map((f, i) => (
              <details
                key={i}
                style={{
                  background: '#fff',
                  border: '1px solid #f0f0f0',
                  borderRadius: 10,
                  padding: '20px 24px',
                  cursor: 'pointer',
                }}
              >
                <summary
                  style={{
                    fontSize: 16,
                    fontWeight: 600,
                    listStyle: 'none',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  {f.q}
                  <span style={{ color: 'rgba(0,0,0,0.4)', fontSize: 12 }}>展开</span>
                </summary>
                <p
                  style={{
                    fontSize: 14,
                    color: 'rgba(0,0,0,0.65)',
                    lineHeight: 1.8,
                    margin: '12px 0 0',
                  }}
                >
                  {f.a}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ====== CTA ====== */}
      <section
        style={{
          padding: '80px 24px',
          background: 'linear-gradient(135deg, #1677ff 0%, #722ed1 100%)',
          color: '#fff',
          textAlign: 'center',
        }}
      >
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <CloudOutlined style={{ fontSize: 56, marginBottom: 16 }} />
          <h2 style={{ fontSize: 36, fontWeight: 700, margin: '0 0 16px' }}>立即开始你的电商自动化之旅</h2>
          <p style={{ fontSize: 16, opacity: 0.9, margin: '0 0 32px' }}>
            14 天免费试用，无需信用卡，快速接入。
          </p>
          <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
            <button onClick={() => nav('/register')} style={btnWhiteLg}>
              免费注册 <ArrowRightOutlined />
            </button>
            <Link to="/login" style={{ ...btnGhostWhiteLg, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
              已有账号? 登录
            </Link>
          </div>
        </div>
      </section>

      {/* ====== Footer ====== */}
      <footer style={{ padding: '40px 24px', background: '#0a0a0a', color: 'rgba(255,255,255,0.65)' }}>
        <div
          style={{
            maxWidth: 1200,
            margin: '0 auto',
            display: 'grid',
            gridTemplateColumns: '2fr 1fr 1fr 1fr',
            gap: 40,
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <BrandLogo size={32} color="#fff" />
              <span style={{ color: '#fff', fontWeight: 700, fontSize: 16 }}>thalvior</span>
            </div>
            <p style={{ fontSize: 13, lineHeight: 1.7, margin: 0 }}>
              跨境电商一体化管理平台，让出海更简单。
              <br />
              持续服务跨境电商卖家。
            </p>
          </div>
          <div>
            <h4 style={{ color: '#fff', fontSize: 14, margin: '0 0 14px' }}>产品</h4>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 13, lineHeight: 2 }}>
              <li><button onClick={() => nav('/order/list')} style={footerLink}>订单管理</button></li>
              <li><button onClick={() => nav('/product/sku/list')} style={footerLink}>商品管理</button></li>
              <li><button onClick={() => nav('/warehouse/inventory')} style={footerLink}>库存管理</button></li>
              <li><button onClick={() => nav('/data/overview')} style={footerLink}>BI 数据看板</button></li>
            </ul>
          </div>
          <div>
            <h4 style={{ color: '#fff', fontSize: 14, margin: '0 0 14px' }}>资源</h4>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 13, lineHeight: 2 }}>
              <li><span style={footerDisabled}>使用文档（即将上线）</span></li>
              <li><span style={footerDisabled}>API 文档（即将上线）</span></li>
              <li><span style={footerDisabled}>更新日志（即将上线）</span></li>
              <li><span style={footerDisabled}>最佳实践（即将上线）</span></li>
            </ul>
          </div>
          <div>
            <h4 style={{ color: '#fff', fontSize: 14, margin: '0 0 14px' }}>关于</h4>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 13, lineHeight: 2 }}>
              <li><span style={footerDisabled}>关于我们（即将上线）</span></li>
              <li><span style={footerDisabled}>联系销售（即将上线）</span></li>
              <li><span style={footerDisabled}>隐私政策（即将上线）</span></li>
              <li><span style={footerDisabled}>服务条款（即将上线）</span></li>
            </ul>
          </div>
        </div>
        <div
          style={{
            maxWidth: 1200,
            margin: '32px auto 0',
            paddingTop: 24,
            borderTop: '1px solid rgba(255,255,255,0.1)',
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 12,
            color: 'rgba(255,255,255,0.4)',
          }}
        >
          <span>© 2026 thalvior. All rights reserved.</span>
          <span>
            <CodeOutlined style={{ marginRight: 4 }} />
            用 ❤️ 打造
          </span>
        </div>
      </footer>
    </div>
  );
}

// 样式
const navLinkStyle: React.CSSProperties = {
  color: 'rgba(0,0,0,0.75)',
  textDecoration: 'none',
  fontSize: 14,
  fontWeight: 500,
};
const btnBase: React.CSSProperties = {
  border: 'none',
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 500,
  borderRadius: 8,
  padding: '8px 16px',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  transition: 'all 0.2s',
};
const btnGhost: React.CSSProperties = {
  ...btnBase,
  background: 'transparent',
  color: 'rgba(0,0,0,0.85)',
};
const btnPrimary: React.CSSProperties = {
  ...btnBase,
  background: '#1677ff',
  color: '#fff',
  boxShadow: '0 4px 12px rgba(22,119,255,0.3)',
};
const btnPrimaryLg: React.CSSProperties = {
  ...btnPrimary,
  padding: '14px 28px',
  fontSize: 16,
  fontWeight: 600,
};
const btnGhostLg: React.CSSProperties = {
  ...btnBase,
  background: '#fff',
  color: 'rgba(0,0,0,0.85)',
  border: '1px solid #d9d9d9',
  padding: '14px 28px',
  fontSize: 16,
  fontWeight: 600,
  textDecoration: 'none',
};
const btnWhiteLg: React.CSSProperties = {
  ...btnPrimaryLg,
  background: '#fff',
  color: '#1677ff',
};
const btnGhostWhiteLg: React.CSSProperties = {
  ...btnGhostLg,
  background: 'transparent',
  color: '#fff',
  border: '1px solid rgba(255,255,255,0.5)',
};
const footerLink: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'rgba(255,255,255,0.65)',
  cursor: 'pointer',
  padding: 0,
  fontSize: 13,
  lineHeight: 2,
  textDecoration: 'none',
};
const footerDisabled: React.CSSProperties = {
  color: 'rgba(255,255,255,0.35)',
  fontSize: 13,
  lineHeight: 2,
};
