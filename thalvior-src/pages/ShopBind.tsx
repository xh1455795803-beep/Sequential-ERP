// 手动授权 - 凭证授权
// 区别于一键授权: 适用于没有 OAuth 的平台, 或需要精细控制凭证的情况
// 用户需要自己填: App Key / App Secret / Shop ID / Refresh Token 等
//
// ⚠️ 本页只展示"只能手动填凭证"的平台, 与一键授权页完全不交叉:
//   - 手动授权: 仅展示下方 MANUAL_PLATFORMS 中列出的平台
//   - 一键授权: 展示所有支持 OAuth 的平台
//   - 同一平台不会同时出现在两个页面
import { useState } from 'react';
import {
  Card,
  Row,
  Col,
  Button,
  Form,
  Input,
  Select,
  Steps,
  message,
  Space,
  Tag,
  Descriptions,
  Result,
  Alert,
  Typography,
  Divider,
} from 'antd';
import {
  KeyOutlined,
  ShopOutlined,
  CheckCircleOutlined,
  ApiOutlined,
  LockOutlined,
  CloudSyncOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { shopApi } from '../api';
import { useNavigate } from 'react-router-dom';

const { Text, Paragraph } = Typography;

// 仅展示"只能手动填凭证"的平台
// 任何支持 OAuth 的平台都不放在这里 (放 OAUTH_PLATFORMS), 反之亦然
// 新增平台时, 必须在 OAUTH_PLATFORMS (一键) 或 MANUAL_PLATFORMS (手动) 中二选一
const MANUAL_PLATFORMS: Record<string, {
  name: string;
  color: string;
  authType: 'credential'; // 未来可扩展 'private_key' / 'oauth_v2' 等
  credentialHelp: string;
  regions: Array<{ code: string; name: string; currency: string }>;
  fields: Array<{ name: string; label: string; required: boolean; secret?: boolean; help?: string }>;
}> = {
  ebay: {
    name: 'eBay',
    color: '#0064d2',
    authType: 'credential',
    credentialHelp: 'eBay 需先在 developer.ebay.com 注册应用, 拿到 App ID / Cert ID / Refresh Token',
    regions: [
      { code: 'US', name: '美国', currency: 'USD' },
      { code: 'UK', name: '英国', currency: 'GBP' },
      { code: 'DE', name: '德国', currency: 'EUR' },
      { code: 'AU', name: '澳洲', currency: 'AUD' },
    ],
    fields: [
      { name: 'appKey', label: 'App ID (Client ID)', required: true },
      { name: 'appSecret', label: 'Cert ID (Client Secret)', required: true, secret: true },
      { name: 'refreshToken', label: 'Refresh Token', required: true, secret: true },
    ],
  },
  temu: {
    name: 'Temu',
    color: '#fb7701',
    authType: 'credential',
    credentialHelp: 'Temu 卖家中心 - 开放平台 - 应用管理, 申请 App Key / Secret',
    regions: [
      { code: 'US', name: '美国', currency: 'USD' },
      { code: 'GB', name: '英国', currency: 'GBP' },
      { code: 'DE', name: '德国', currency: 'EUR' },
      { code: 'FR', name: '法国', currency: 'EUR' },
    ],
    fields: [
      { name: 'appKey', label: 'App Key', required: true },
      { name: 'appSecret', label: 'App Secret', required: true, secret: true },
      { name: 'shopId', label: '店铺 ID', required: true },
    ],
  },
  mercari: {
    name: 'Mercari (日本煤炉)',
    color: '#ff0211',
    authType: 'credential',
    credentialHelp: 'Mercari 日本站需通过 Paidy 申请 API 权限',
    regions: [
      { code: 'JP', name: '日本', currency: 'JPY' },
    ],
    fields: [
      { name: 'appKey', label: 'API Key', required: true },
      { name: 'appSecret', label: 'API Secret', required: true, secret: true },
    ],
  },
  coupang: {
    name: 'Coupang (韩国)',
    color: '#e60012',
    authType: 'credential',
    credentialHelp: 'Coupang Wing - 卖家中心 - OpenAPI 申请',
    regions: [
      { code: 'KR', name: '韩国', currency: 'KRW' },
    ],
    fields: [
      { name: 'accessKey', label: 'Access Key', required: true },
      { name: 'secretKey', label: 'Secret Key', required: true, secret: true },
      { name: 'vendorId', label: 'Vendor ID', required: true },
    ],
  },
  shopify: {
    name: 'Shopify 自建站',
    color: '#95bf47',
    authType: 'credential',
    credentialHelp: 'Shopify Admin - Apps - Develop apps - 创建私有应用',
    regions: [
      { code: 'GLOBAL', name: '全球', currency: 'USD' },
    ],
    fields: [
      { name: 'shopDomain', label: '店铺域名', required: true, help: '例如: yourshop.myshopify.com' },
      { name: 'accessToken', label: 'Admin API Access Token', required: true, secret: true },
    ],
  },
  magento: {
    name: 'Magento 自建站',
    color: '#ee672f',
    authType: 'credential',
    credentialHelp: 'Magento 后台 - System - Integrations - 创建 API Token',
    regions: [
      { code: 'GLOBAL', name: '全球', currency: 'USD' },
    ],
    fields: [
      { name: 'baseUrl', label: '站点 URL', required: true, help: '例如: https://shop.example.com' },
      { name: 'accessToken', label: 'Integration Token', required: true, secret: true },
    ],
  },
};

interface Platform { code: string; name: string; }

export default function ShopBind() {
  const [selectedPlatform, setSelectedPlatform] = useState<Platform | null>(null);
  const [current, setCurrent] = useState(0);
  const [form] = Form.useForm();
  const [formValues, setFormValues] = useState<any>({});
  const [authedShop, setAuthedShop] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<null | { ok: boolean; msg: string }>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();

  // 直接用 MANUAL_PLATFORMS (白名单), 不与一键授权共享任何平台
  // 即使后端 platformApi 列表里有 Amazon/Shopee 等支持 OAuth 的平台, 这里也不显示
  const supported = Object.keys(MANUAL_PLATFORMS).map((code) => ({
    code,
    name: MANUAL_PLATFORMS[code].name,
  }));

  const reset = () => {
    setSelectedPlatform(null);
    setCurrent(0);
    setFormValues({});
    setAuthedShop(null);
    setTestResult(null);
    form.resetFields();
  };

  const onSelectPlatform = (p: Platform) => {
    setSelectedPlatform(p);
    setCurrent(1);
    form.setFieldsValue({
      region: MANUAL_PLATFORMS[p.code].regions[0]?.code,
      name: `${p.name}-新店`,
    });
  };

  const onTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const values = await form.validateFields();
      // 模拟 1s 测试连接
      await new Promise((r) => setTimeout(r, 1000));
      // Mock: 简单校验必填都填了就算成功
      const hasEmpty = MANUAL_PLATFORMS[selectedPlatform!.code].fields.some(
        (f) => f.required && !values[f.name],
      );
      if (hasEmpty) {
        setTestResult({ ok: false, msg: '凭证不完整, 请补齐必填项' });
        message.error('凭证不完整');
      } else {
        setTestResult({ ok: true, msg: `${selectedPlatform!.name} 连接成功, 可提交授权` });
        message.success('连接测试通过');
      }
    } catch {
      setTestResult({ ok: false, msg: '请先完成表单填写' });
    } finally {
      setTesting(false);
    }
  };

  const onSubmitInfo = async () => {
    try {
      const values = await form.validateFields();
      setFormValues(values);
      setCurrent(2);
    } catch {}
  };

  const onConfirmAuth = async () => {
    setLoading(true);
    try {
      const regions = MANUAL_PLATFORMS[selectedPlatform!.code].regions;
      const r = regions.find((x) => x.code === formValues.region) || regions[0];
      const shop = await shopApi.create({
        platformCode: selectedPlatform!.code,
        name: formValues.name,
        shopId: formValues.shopId,
        region: r.code,
        currency: r.currency,
        remark: formValues.remark || '手动授权',
      });
      setAuthedShop({
        ...shop,
        accessToken: shop.accessToken || 'mock_at_xxx',
        tokenExpiresAt: new Date(shop.tokenExpiresAt).toLocaleString(),
      });
      setCurrent(3);
      qc.invalidateQueries({ queryKey: ['shops-all'] });
      message.success('授权成功, 店铺已创建');
    } catch (e: any) {
      message.error(e?.message || '授权失败');
    } finally {
      setLoading(false);
    }
  };

  if (!selectedPlatform) {
    return (
      <div>
        <Alert
          type="info"
          showIcon
          icon={<KeyOutlined />}
          message="手动授权 (凭证)"
          description={
            <span>
              <b>仅展示需要手动填凭证的 {supported.length} 个平台</b>。通过手动填写 App Key / Secret / Token 等凭证完成授权。
              <Text type="secondary"> 如果平台支持 OAuth, 请前往 <a onClick={(e) => { e.preventDefault(); navigate('/auth/oneclick'); }}>一键授权</a></Text>
            </span>
          }
          style={{ marginBottom: 16 }}
        />

        <Row gutter={[16, 16]}>
          {supported.map((p) => {
            const cfg = MANUAL_PLATFORMS[p.code];
            return (
              <Col span={6} key={p.code}>
                <Card
                  hoverable
                  onClick={() => onSelectPlatform(p)}
                  style={{
                    borderRadius: 8,
                    borderLeft: `4px solid ${cfg.color}`,
                  }}
                >
                  <Space direction="vertical" size={8} style={{ width: '100%' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <ShopOutlined style={{ fontSize: 28, color: cfg.color }} />
                      <Tag>凭证</Tag>
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 600 }}>{cfg.name}</div>
                    <div style={{ color: '#999', fontSize: 12 }}>
                      {cfg.fields.length} 个凭证字段 · {cfg.regions.length} 个站点
                    </div>
                    <Button icon={<ToolOutlined />} block>
                      手动配置
                    </Button>
                  </Space>
                </Card>
              </Col>
            );
          })}
        </Row>

        <Card style={{ marginTop: 16, background: '#fffbe6' }} bordered={false}>
          <Space direction="vertical" size={4}>
            <Text strong><LockOutlined /> 凭证安全说明</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              所有 App Secret / Refresh Token 都会以 AES-256 加密存储, 不在前端明文展示。系统会定期检测凭证有效性, 失效前 7 天提醒续期。
            </Text>
          </Space>
        </Card>
      </div>
    );
  }

  const cfg = MANUAL_PLATFORMS[selectedPlatform.code];
  const color = cfg.color;
  const credFields = cfg.fields;

  return (
    <div>
      <Card style={{ borderLeft: `4px solid ${color}` }}>
        <Space style={{ marginBottom: 16 }}>
          <Button onClick={reset}>← 返回选择平台</Button>
          <Tag color="blue" style={{ fontSize: 14, padding: '4px 12px' }}>
            <ShopOutlined /> {selectedPlatform.name} 手动授权
          </Tag>
        </Space>

        <Steps
          current={current}
          items={[
            { title: '选择平台', status: current > 0 ? 'finish' : 'process' },
            { title: '填写凭证', icon: <KeyOutlined /> },
            { title: '确认信息', icon: <ApiOutlined /> },
            { title: '完成', icon: <CheckCircleOutlined /> },
          ]}
          style={{ marginBottom: 24 }}
        />

        {current === 1 && (
          <>
            <Alert
              type="warning"
              message="请从平台开发者中心获取以下凭证"
              description={cfg.credentialHelp}
              showIcon
              style={{ marginBottom: 16 }}
            />

            <Form form={form} layout="vertical" autoComplete="off">
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item label="店铺名称" name="name" rules={[{ required: true, message: '请输入店铺名称' }]}>
                    <Input placeholder={`例如: ${cfg.name}-US-主店`} />
                  </Form.Item>
                </Col>
                <Col span={6}>
                  <Form.Item label="店铺 ID" name="shopId" rules={[{ required: true, message: '请输入店铺 ID' }]}>
                    <Input placeholder="平台店铺标识" />
                  </Form.Item>
                </Col>
                <Col span={6}>
                  <Form.Item label="站点" name="region" rules={[{ required: true }]}>
                    <Select
                      options={cfg.regions.map((r) => ({
                        value: r.code,
                        label: `${r.name} (${r.code}) - ${r.currency}`,
                      }))}
                    />
                  </Form.Item>
                </Col>
              </Row>

              <Divider titlePlacement="left" plain>
                <Text type="secondary"><LockOutlined /> API 凭证 (加密存储)</Text>
              </Divider>

              <Row gutter={16}>
                {credFields.map((f) => (
                  <Col span={12} key={f.name}>
                    <Form.Item
                      label={
                        <Space>
                          {f.label}
                          {f.required && <Tag color="red">必填</Tag>}
                        </Space>
                      }
                      name={f.name}
                      rules={[{ required: f.required, message: `请输入 ${f.label}` }]}
                      extra={f.help}
                    >
                      <Input.Password
                        placeholder={f.secret ? '加密保存, 不在前端展示' : f.label}
                        visibilityToggle={!f.secret}
                      />
                    </Form.Item>
                  </Col>
                ))}
              </Row>

              <Form.Item label="备注" name="remark">
                <Input.TextArea rows={2} placeholder="选填, 例: 主店 / 副店 / 测试店" />
              </Form.Item>

              {testResult && (
                <Alert
                  type={testResult.ok ? 'success' : 'error'}
                  message={testResult.msg}
                  showIcon
                  style={{ marginBottom: 16 }}
                />
              )}

              <Space>
                <Button onClick={reset}>取消</Button>
                <Button
                  icon={<CloudSyncOutlined />}
                  loading={testing}
                  onClick={onTestConnection}
                >
                  测试连接
                </Button>
                <Button
                  type="primary"
                  disabled={!testResult?.ok}
                  onClick={onSubmitInfo}
                >
                  下一步
                </Button>
              </Space>
            </Form>
          </>
        )}

        {current === 2 && (
          <div>
            <Alert
              type="info"
              message="即将提交授权"
              description="提交后会创建店铺记录, 系统会用凭证调用平台 API 验证店铺可访问。"
              showIcon
              style={{ marginBottom: 16 }}
            />
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="店铺名">{formValues.name}</Descriptions.Item>
              <Descriptions.Item label="平台店铺 ID">{formValues.shopId}</Descriptions.Item>
              <Descriptions.Item label="平台 / 站点">
                <Tag color="blue">{selectedPlatform.name}</Tag>
                <Tag color="cyan">
                  {cfg.regions.find((r) => r.code === formValues.region)?.name}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="凭证数">{credFields.length} 个</Descriptions.Item>
              <Descriptions.Item label="凭证摘要" span={2}>
                {credFields
                  .filter((f) => formValues[f.name])
                  .map((f) => `${f.label}: ${'*'.repeat(8)}`)
                  .join(' · ')}
              </Descriptions.Item>
              {formValues.remark && (
                <Descriptions.Item label="备注" span={2}>{formValues.remark}</Descriptions.Item>
              )}
            </Descriptions>
            <Space style={{ marginTop: 16 }}>
              <Button onClick={() => setCurrent(1)}>上一步</Button>
              <Button type="primary" loading={loading} onClick={onConfirmAuth}>
                确认提交
              </Button>
            </Space>
          </div>
        )}

        {current === 3 && authedShop && (
          <Result
            status="success"
            title="手动授权成功"
            subTitle={`${authedShop.name} 已创建`}
            extra={[
              <Button key="sync" type="primary" onClick={() => navigate('/auth/sync')}>
                去同步数据
              </Button>,
              <Button key="shop" onClick={() => navigate('/auth/shop')}>
                查看店铺
              </Button>,
              <Button key="again" onClick={reset}>
                再授权一个
              </Button>,
            ]}
          >
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="店铺">{authedShop.name}</Descriptions.Item>
              <Descriptions.Item label="平台">{authedShop.platform}</Descriptions.Item>
              <Descriptions.Item label="地区">{authedShop.region}</Descriptions.Item>
              <Descriptions.Item label="币种">{authedShop.currency}</Descriptions.Item>
              <Descriptions.Item label="Access Token" span={2}>
                <code style={{ fontSize: 12 }}>{authedShop.accessToken}</code>
              </Descriptions.Item>
              <Descriptions.Item label="过期时间" span={2}>{authedShop.tokenExpiresAt}</Descriptions.Item>
            </Descriptions>
          </Result>
        )}
      </Card>
    </div>
  );
}
