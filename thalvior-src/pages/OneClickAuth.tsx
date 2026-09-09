// 一键授权 - 平台 OAuth 快捷授权
// 区别于手动授权: 此流程由平台主导, 系统只负责接收回调 token
// 流程: 选择平台 -> 跳平台登录页 -> 用户授权 -> 回调系统 -> 自动建店
//
// ⚠️ 本页只展示"支持 OAuth 一键授权"的平台, 与手动授权页完全不交叉:
//   - 一键授权: 仅展示下方 OAUTH_PLATFORMS 中列出的平台
//   - 手动授权: 展示所有需要凭证的平台 (可能比一键多很多)
import { useState } from 'react';
import {
  Card,
  Row,
  Col,
  Button,
  Tag,
  Space,
  Result,
  Steps,
  Alert,
  Spin,
  QRCode,
  Typography,
  Statistic,
  message,
} from 'antd';
import {
  ThunderboltOutlined,
  CheckCircleOutlined,
  ApiOutlined,
  ClockCircleOutlined,
  ScanOutlined,
  RocketOutlined,
  ShopOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { shopApi } from '../api';

const { Text, Paragraph } = Typography;

// 支持 OAuth 一键授权的平台白名单
// 与手动授权页 MANUAL_PLATFORMS 互不交叉:
//   - 一键授权: 平台提供 OAuth 流程, 用户无需填任何凭证
//   - 手动授权: 平台只提供 API 凭证 (App Key/Secret), 用户需自己填
// 新增平台时, 必须明确"走 OAuth"还是"走凭证", 不要两者都列
const OAUTH_PLATFORMS: Record<string, { name: string; color: string; regions: Array<{ code: string; name: string; currency: string; flag: string }>; authUrl: string }> = {
  amazon: {
    name: 'Amazon',
    color: '#ff9900',
    authUrl: 'https://sellercentral.amazon.com/apps/authorize/consent',
    regions: [
      { code: 'US', name: '美国站', currency: 'USD', flag: '🇺🇸' },
      { code: 'DE', name: '德国站', currency: 'EUR', flag: '🇩🇪' },
      { code: 'JP', name: '日本站', currency: 'JPY', flag: '🇯🇵' },
      { code: 'UK', name: '英国站', currency: 'GBP', flag: '🇬🇧' },
      { code: 'FR', name: '法国站', currency: 'EUR', flag: '🇫🇷' },
    ],
  },
  tiktok: {
    name: 'TikTok Shop',
    color: '#000000',
    authUrl: 'https://seller.tiktok.com/university/essentials/authorization',
    regions: [
      { code: 'US', name: '美国', currency: 'USD', flag: '🇺🇸' },
      { code: 'UK', name: '英国', currency: 'GBP', flag: '🇬🇧' },
      { code: 'ID', name: '印尼', currency: 'IDR', flag: '🇮🇩' },
      { code: 'MY', name: '马来', currency: 'MYR', flag: '🇲🇾' },
      { code: 'TH', name: '泰国', currency: 'THB', flag: '🇹🇭' },
      { code: 'PH', name: '菲律宾', currency: 'PHP', flag: '🇵🇭' },
      { code: 'VN', name: '越南', currency: 'VND', flag: '🇻🇳' },
    ],
  },
  shopee: {
    name: 'Shopee',
    color: '#ee4d2d',
    authUrl: 'https://open.shopee.com/console',
    regions: [
      { code: 'SG', name: '新加坡', currency: 'SGD', flag: '🇸🇬' },
      { code: 'MY', name: '马来', currency: 'MYR', flag: '🇲🇾' },
      { code: 'TH', name: '泰国', currency: 'THB', flag: '🇹🇭' },
      { code: 'ID', name: '印尼', currency: 'IDR', flag: '🇮🇩' },
      { code: 'PH', name: '菲律宾', currency: 'PHP', flag: '🇵🇭' },
      { code: 'TW', name: '台湾', currency: 'TWD', flag: '🇹🇼' },
      { code: 'VN', name: '越南', currency: 'VND', flag: '🇻🇳' },
    ],
  },
  lazada: {
    name: 'Lazada',
    color: '#0f146d',
    authUrl: 'https://open.lazada.com/apps',
    regions: [
      { code: 'TH', name: '泰国', currency: 'THB', flag: '🇹🇭' },
      { code: 'ID', name: '印尼', currency: 'IDR', flag: '🇮🇩' },
      { code: 'MY', name: '马来', currency: 'MYR', flag: '🇲🇾' },
      { code: 'PH', name: '菲律宾', currency: 'PHP', flag: '🇵🇭' },
      { code: 'VN', name: '越南', currency: 'VND', flag: '🇻🇳' },
      { code: 'SG', name: '新加坡', currency: 'SGD', flag: '🇸🇬' },
    ],
  },
  walmart: {
    name: 'Walmart',
    color: '#0071ce',
    authUrl: 'https://developer.walmart.com/apps',
    regions: [
      { code: 'US', name: '美国', currency: 'USD', flag: '🇺🇸' },
    ],
  },
  aliexpress: {
    name: 'AliExpress',
    color: '#ff4747',
    authUrl: 'https://seller.aliexpress.com/authorize',
    regions: [
      { code: 'RU', name: '俄罗斯', currency: 'RUB', flag: '🇷🇺' },
      { code: 'US', name: '美国', currency: 'USD', flag: '🇺🇸' },
      { code: 'ES', name: '西班牙', currency: 'EUR', flag: '🇪🇸' },
    ],
  },
};

interface Platform { code: string; name: string; }

export default function OneClickAuth() {
  const [selectedPlatform, setSelectedPlatform] = useState<Platform | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<string>('');
  const [current, setCurrent] = useState(0); // 0=选平台 1=等待授权 2=完成
  const [authedShop, setAuthedShop] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  // 直接用 OAUTH_PLATFORMS (白名单), 不要再做"根据后端返回的平台过滤"
  // 原因: 即使某个平台被加到了 platformApi 列表里, 但没接入 OAuth, 也不应该在这里显示
  const supported = Object.keys(OAUTH_PLATFORMS).map((code) => ({
    code,
    name: OAUTH_PLATFORMS[code].name,
  }));

  const reset = () => {
    setSelectedPlatform(null);
    setSelectedRegion('');
    setCurrent(0);
    setAuthedShop(null);
  };

  const onSelectPlatform = (p: Platform) => {
    setSelectedPlatform(p);
    setSelectedRegion(OAUTH_PLATFORMS[p.code].regions[0]?.code || '');
    setCurrent(1);
  };

  // 模拟 OAuth 流程: 跳平台 → 回调
  // 真实场景: window.open(OAUTH_PLATFORMS[code].authUrl) → 平台登录 → 跳转回 /auth-callback?code=xxx → 后端换 token
  const onConfirmAuth = async () => {
    setLoading(true);
    try {
      // 模拟 1.5s 跳转延迟
      await new Promise((r) => setTimeout(r, 1500));
      const region = OAUTH_PLATFORMS[selectedPlatform!.code].regions.find((r) => r.code === selectedRegion);
      const shop = await shopApi.create({
        platformCode: selectedPlatform!.code,
        name: `${selectedPlatform!.name}-${region?.name || selectedRegion}`,
        shopId: `auto_${selectedPlatform!.code}_${Date.now()}`,
        region: selectedRegion,
        currency: region?.currency || 'USD',
        remark: '一键授权',
      });
      setAuthedShop({
        ...shop,
        accessToken: shop.accessToken || 'mock_at_xxx',
        tokenExpiresAt: new Date(shop.tokenExpiresAt).toLocaleString(),
      });
      setCurrent(2);
      message.success('授权成功, 店铺已创建');
    } catch (e: any) {
      message.error(e?.message || '授权失败');
    } finally {
      setLoading(false);
    }
  };

  const color = selectedPlatform ? OAUTH_PLATFORMS[selectedPlatform.code]?.color : '#1677ff';

  return (
    <div>
      <Alert
        type="info"
        showIcon
        icon={<ThunderboltOutlined />}
        message="一键授权"
        description={
          <span>
            <b>仅展示支持 OAuth 的 {supported.length} 个平台</b>。选择平台 → 跳转平台登录 → 同意授权 → 自动建店。
            整个过程无需填写店铺 ID、密钥等信息。
            <Text type="secondary"> (如平台不在此列表, 请前往 <a onClick={(e) => { e.preventDefault(); navigate('/auth/manual'); }}>手动授权 (凭证)</a>)</Text>
          </span>
        }
        style={{ marginBottom: 16 }}
      />

      {/* 平台选择卡片 - 只展示 OAUTH_PLATFORMS 中列出的平台 */}
      {current === 0 && (
        <Row gutter={[16, 16]}>
          {supported.map((p) => {
            const cfg = OAUTH_PLATFORMS[p.code];
            return (
              <Col span={6} key={p.code}>
                <Card
                  hoverable
                  onClick={() => onSelectPlatform(p)}
                  style={{
                    borderRadius: 8,
                    borderTop: `3px solid ${cfg.color}`,
                  }}
                >
                  <Space direction="vertical" size={8} style={{ width: '100%' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <ShopOutlined style={{ fontSize: 32, color: cfg.color }} />
                      <Tag color="green">OAuth</Tag>
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 600 }}>{cfg.name}</div>
                    <div style={{ color: '#999', fontSize: 12 }}>
                      支持 {cfg.regions.length} 个站点
                    </div>
                    <Button type="primary" icon={<ThunderboltOutlined />} block style={{ background: cfg.color, borderColor: cfg.color }}>
                      一键授权
                    </Button>
                  </Space>
                </Card>
              </Col>
            );
          })}
        </Row>
      )}

      {/* 等待授权 */}
      {current === 1 && selectedPlatform && (
        <Card style={{ borderRadius: 8, borderTop: `3px solid ${color}` }}>
          <Steps
            current={0}
            items={[
              { title: '选择平台', status: 'finish' },
              { title: '跳转平台登录', status: 'process' },
              { title: '回调建店', status: 'wait' },
            ]}
            style={{ marginBottom: 32 }}
          />

          <Row gutter={32}>
            <Col span={12}>
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <div>
                  <Text type="secondary">已选平台</Text>
                  <div style={{ fontSize: 24, fontWeight: 600, color }}>
                    {selectedPlatform.name}
                  </div>
                </div>

                <div>
                  <Text type="secondary">目标站点</Text>
                  <div style={{ marginTop: 8 }}>
                    <Space wrap>
                      {OAUTH_PLATFORMS[selectedPlatform.code].regions.map((r) => (
                        <Tag.CheckableTag
                          key={r.code}
                          checked={selectedRegion === r.code}
                          onChange={() => setSelectedRegion(r.code)}
                          style={{ padding: '4px 12px', fontSize: 14 }}
                        >
                          {r.flag} {r.name} ({r.code})
                        </Tag.CheckableTag>
                      ))}
                    </Space>
                  </div>
                </div>

                <Alert
                  type="warning"
                  message="即将跳转到平台登录页"
                  description="点击下方按钮后, 系统会打开平台官方授权页。完成授权后会自动返回本系统创建店铺。"
                  showIcon
                />

                <Space>
                  <Button onClick={reset}>取消</Button>
                  <Button
                    type="primary"
                    icon={<RocketOutlined />}
                    loading={loading}
                    onClick={onConfirmAuth}
                    size="large"
                    style={{ background: color, borderColor: color }}
                  >
                    立即跳转授权
                  </Button>
                </Space>
              </Space>
            </Col>

            <Col span={12}>
              <Card style={{ background: '#fafafa', textAlign: 'center' }} bordered={false}>
                <Spin spinning={loading} tip="等待平台回调...">
                  <div style={{ padding: 24 }}>
                    <Text type="secondary">
                      <ScanOutlined /> 移动端扫码授权
                    </Text>
                    <div style={{ marginTop: 16 }}>
                      <QRCode
                        value={`https://oauth.${selectedPlatform.code}.com/authorize?client_id=thalvior&redirect_uri=/auth-callback&region=${selectedRegion}`}
                        size={180}
                      />
                    </div>
                    <Paragraph type="secondary" style={{ marginTop: 16, fontSize: 12 }}>
                      手机扫码后, 在 {selectedPlatform.name} App 内一键确认授权
                    </Paragraph>
                  </div>
                </Spin>
              </Card>
            </Col>
          </Row>
        </Card>
      )}

      {/* 完成 */}
      {current === 2 && authedShop && (
        <Result
          status="success"
          icon={<CheckCircleOutlined style={{ color }} />}
          title="授权成功"
          subTitle={`${authedShop.name} 已创建, 30 秒内可开始拉取订单`}
          extra={[
            <Button key="sync" type="primary" onClick={() => navigate('/auth/sync')}>
              立即同步数据
            </Button>,
            <Button key="shop" onClick={() => navigate('/auth/shop')}>
              查看店铺
            </Button>,
            <Button key="again" onClick={reset}>
              继续授权其他店铺
            </Button>,
          ]}
        >
          <Row gutter={16} style={{ maxWidth: 800, margin: '0 auto' }}>
            <Col span={8}>
              <Statistic title="店铺" value={authedShop.name} valueStyle={{ fontSize: 14 }} />
            </Col>
            <Col span={8}>
              <Statistic title="平台 / 站点" value={`${authedShop.platform} · ${authedShop.region}`} valueStyle={{ fontSize: 14 }} />
            </Col>
            <Col span={8}>
              <Statistic
                title="Token 有效期"
                value={authedShop.tokenExpiresAt}
                prefix={<ClockCircleOutlined />}
                valueStyle={{ fontSize: 14 }}
              />
            </Col>
          </Row>
        </Result>
      )}

      {/* 底部说明 */}
      {current === 0 && (
        <Card style={{ marginTop: 16, background: '#f0f5ff' }} bordered={false}>
          <Row gutter={32}>
            <Col span={8}>
              <Space direction="vertical" size={4}>
                <Text strong><ThunderboltOutlined /> 30 秒完成</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>无需填表, 平台自动同步店铺信息</Text>
              </Space>
            </Col>
            <Col span={8}>
              <Space direction="vertical" size={4}>
                <Text strong><ApiOutlined /> 自动续期</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>系统自动刷新 access_token, 无需人工介入</Text>
              </Space>
            </Col>
            <Col span={8}>
              <Space direction="vertical" size={4}>
                <Text strong><CheckCircleOutlined /> 沙箱友好</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>支持平台测试环境, 不会污染正式数据</Text>
              </Space>
            </Col>
          </Row>
        </Card>
      )}
    </div>
  );
}
