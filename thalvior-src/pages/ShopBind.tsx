// 手动授权 - 凭证授权
// 区别于一键授权: 适用于没有 OAuth 的平台, 或需要精细控制凭证的情况
// 用户需要自己填: App Key / App Secret / Shop ID / Refresh Token 等
//
// ⚠️ 本页只展示"只能手动填凭证"的平台, 与一键授权页完全不交叉:
//   - 手动授权: 仅展示下方 MANUAL_PLATFORMS 中列出的平台
//   - 一键授权: 展示所有支持 OAuth 的平台
//   - 同一平台不会同时出现在两个页面
import { useState, useMemo } from 'react';
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
import { useTranslation } from '../i18n';

const { Text, Paragraph } = Typography;

// 仅展示"只能手动填凭证"的平台
// 任何支持 OAuth 的平台都不放在这里 (放 OAUTH_PLATFORMS), 反之亦然
// 新增平台时, 必须在 OAUTH_PLATFORMS (一键) 或 MANUAL_PLATFORMS (手动) 中二选一
// 注: 展示用字符串已全部迁移到字典 (shopBind.platform.{code}.xxx)
// 这里只保留纯配置字段 (code / color / authType / currency / field name 等)
const MANUAL_PLATFORM_CONFIG: Record<string, {
  color: string;
  authType: 'credential';
  regions: Array<{ code: string; currency: string }>;
  fields: Array<{ name: string; required: boolean; secret?: boolean; helpKey?: string }>;
}> = {
  ebay: {
    color: '#0064d2',
    authType: 'credential',
    regions: [
      { code: 'US', currency: 'USD' },
      { code: 'UK', currency: 'GBP' },
      { code: 'DE', currency: 'EUR' },
      { code: 'AU', currency: 'AUD' },
    ],
    fields: [
      { name: 'appKey', required: true },
      { name: 'appSecret', required: true, secret: true },
      { name: 'refreshToken', required: true, secret: true },
    ],
  },
  temu: {
    color: '#fb7701',
    authType: 'credential',
    regions: [
      { code: 'US', currency: 'USD' },
      { code: 'GB', currency: 'GBP' },
      { code: 'DE', currency: 'EUR' },
      { code: 'FR', currency: 'EUR' },
    ],
    fields: [
      { name: 'appKey', required: true },
      { name: 'appSecret', required: true, secret: true },
      { name: 'shopId', required: true },
    ],
  },
  mercari: {
    color: '#ff0211',
    authType: 'credential',
    regions: [
      { code: 'JP', currency: 'JPY' },
    ],
    fields: [
      { name: 'appKey', required: true },
      { name: 'appSecret', required: true, secret: true },
    ],
  },
  coupang: {
    color: '#e60012',
    authType: 'credential',
    regions: [
      { code: 'KR', currency: 'KRW' },
    ],
    fields: [
      { name: 'accessKey', required: true },
      { name: 'secretKey', required: true, secret: true },
      { name: 'vendorId', required: true },
    ],
  },
  shopify: {
    color: '#95bf47',
    authType: 'credential',
    regions: [
      { code: 'GLOBAL', currency: 'USD' },
    ],
    fields: [
      { name: 'shopDomain', required: true, helpKey: 'platform.shopify.fields.shopDomainHelp' },
      { name: 'accessToken', required: true, secret: true },
    ],
  },
  magento: {
    color: '#ee672f',
    authType: 'credential',
    regions: [
      { code: 'GLOBAL', currency: 'USD' },
    ],
    fields: [
      { name: 'baseUrl', required: true, helpKey: 'platform.magento.fields.baseUrlHelp' },
      { name: 'accessToken', required: true, secret: true },
    ],
  },
};

interface Platform { code: string; name: string; }

// 带翻译的完整平台配置 (组件外也可能用到, 保持独立函数)
function buildPlatformDict(t: (key: string, params?: Record<string, string | number>) => string) {
  const out: Record<string, {
    name: string;
    color: string;
    authType: 'credential';
    credentialHelp: string;
    regions: Array<{ code: string; name: string; currency: string }>;
    fields: Array<{ name: string; label: string; required: boolean; secret?: boolean; help?: string }>;
  }> = {};
  for (const code of Object.keys(MANUAL_PLATFORM_CONFIG)) {
    const cfg = MANUAL_PLATFORM_CONFIG[code];
    const prefix = `pages.shopBind.platform.${code}`;
    out[code] = {
      name: t(`${prefix}.name`),
      color: cfg.color,
      authType: cfg.authType,
      credentialHelp: t(`${prefix}.credentialHelp`),
      regions: cfg.regions.map((r) => ({
        code: r.code,
        currency: r.currency,
        name: t(`pages.shopBind.country.${r.code}`),
      })),
      fields: cfg.fields.map((f) => ({
        name: f.name,
        required: f.required,
        secret: f.secret,
        label: t(`${prefix}.fields.${f.name}`),
        help: f.helpKey ? t(`pages.shopBind.${f.helpKey}`) : undefined,
      })),
    };
  }
  return out;
}

export default function ShopBind() {
  const { t } = useTranslation();
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

  // 带翻译的平台配置
  const MANUAL_PLATFORMS = useMemo(() => buildPlatformDict(t), [t]);

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
      name: `${p.name}${t('pages.shopBind.newShopSuffix')}`,
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
        setTestResult({ ok: false, msg: t('pages.shopBind.message.credentialIncompleteDetail') });
        message.error(t('pages.shopBind.message.credentialIncomplete'));
      } else {
        setTestResult({ ok: true, msg: t('pages.shopBind.message.testSuccessDetail', { name: selectedPlatform!.name }) });
        message.success(t('pages.shopBind.message.testPassed'));
      }
    } catch {
      setTestResult({ ok: false, msg: t('pages.shopBind.message.pleaseFillFormFirst') });
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
        remark: formValues.remark || t('pages.shopBind.defaultRemark'),
      });
      setAuthedShop({
        ...shop,
        accessToken: shop.accessToken || 'mock_at_xxx',
        tokenExpiresAt: new Date(shop.tokenExpiresAt).toLocaleString(),
      });
      setCurrent(3);
      qc.invalidateQueries({ queryKey: ['shops-all'] });
      message.success(t('pages.shopBind.message.authSuccess'));
    } catch (e: any) {
      message.error(e?.message || t('pages.shopBind.message.authFailed'));
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
          message={t('pages.shopBind.alertManualAuthTitle')}
          description={
            <span>
              <b>{t('pages.shopBind.alertManualAuthDesc', { count: supported.length })}</b>
              <Text type="secondary"> {t('pages.shopBind.alertManualAuthDescOauthTip')}
                <a onClick={(e) => { e.preventDefault(); navigate('/auth/oneclick'); }}>
                  {t('pages.shopBind.oneClickAuth')}
                </a>
              </Text>
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
                      <Tag>{t('pages.shopBind.credentialTag')}</Tag>
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 600 }}>{cfg.name}</div>
                    <div style={{ color: '#999', fontSize: 12 }}>
                      {t('pages.shopBind.statFieldsAndRegions', { fields: cfg.fields.length, regions: cfg.regions.length })}
                    </div>
                    <Button icon={<ToolOutlined />} block>
                      {t('pages.shopBind.manualConfig')}
                    </Button>
                  </Space>
                </Card>
              </Col>
            );
          })}
        </Row>

        <Card style={{ marginTop: 16, background: '#fffbe6' }} bordered={false}>
          <Space direction="vertical" size={4}>
            <Text strong><LockOutlined /> {t('pages.shopBind.alertSecurityTitle')}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('pages.shopBind.alertSecurityDesc')}
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
          <Button onClick={reset}>{t('pages.shopBind.backToSelect')}</Button>
          <Tag color="blue" style={{ fontSize: 14, padding: '4px 12px' }}>
            <ShopOutlined /> {t('pages.shopBind.manualAuthTag', { name: selectedPlatform.name })}
          </Tag>
        </Space>

        <Steps
          current={current}
          items={[
            { title: t('pages.shopBind.stepSelectPlatform'), status: current > 0 ? 'finish' : 'process' },
            { title: t('pages.shopBind.stepFillCredential'), icon: <KeyOutlined /> },
            { title: t('pages.shopBind.stepConfirmInfo'), icon: <ApiOutlined /> },
            { title: t('pages.shopBind.stepDone'), icon: <CheckCircleOutlined /> },
          ]}
          style={{ marginBottom: 24 }}
        />

        {current === 1 && (
          <>
            <Alert
              type="warning"
              message={t('pages.shopBind.alertGetCredentialTitle')}
              description={cfg.credentialHelp}
              showIcon
              style={{ marginBottom: 16 }}
            />

            <Form form={form} layout="vertical" autoComplete="off">
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item
                    label={t('pages.shopBind.formShopName')}
                    name="name"
                    rules={[{ required: true, message: t('common.pleaseInput') + t('pages.shopBind.formShopName') }]}
                  >
                    <Input placeholder={t('pages.shopBind.placeholder.shopNameExample', { name: cfg.name })} />
                  </Form.Item>
                </Col>
                <Col span={6}>
                  <Form.Item
                    label={t('pages.shopBind.formShopId')}
                    name="shopId"
                    rules={[{ required: true, message: t('common.pleaseInput') + t('pages.shopBind.formShopId') }]}
                  >
                    <Input placeholder={t('pages.shopBind.placeholder.shopId')} />
                  </Form.Item>
                </Col>
                <Col span={6}>
                  <Form.Item label={t('pages.shopBind.formRegion')} name="region" rules={[{ required: true }]}>
                    <Select
                      options={cfg.regions.map((r) => ({
                        value: r.code,
                        label: t('pages.shopBind.formRegionOption', { name: r.name, code: r.code, currency: r.currency }),
                      }))}
                    />
                  </Form.Item>
                </Col>
              </Row>

              <Divider titlePlacement="left" plain>
                <Text type="secondary"><LockOutlined /> {t('pages.shopBind.formApiCredential')}</Text>
              </Divider>

              <Row gutter={16}>
                {credFields.map((f) => (
                  <Col span={12} key={f.name}>
                    <Form.Item
                      label={
                        <Space>
                          {f.label}
                          {f.required && <Tag color="red">{t('pages.shopBind.requiredTag')}</Tag>}
                        </Space>
                      }
                      name={f.name}
                      rules={[{ required: f.required, message: t('common.pleaseInput') + f.label }]}
                      extra={f.help}
                    >
                      <Input.Password
                        placeholder={f.secret ? t('pages.shopBind.saveEncrypted') : f.label}
                        visibilityToggle={!f.secret}
                      />
                    </Form.Item>
                  </Col>
                ))}
              </Row>

              <Form.Item label={t('pages.shopBind.formRemark')} name="remark">
                <Input.TextArea rows={2} placeholder={t('pages.shopBind.placeholder.remark')} />
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
                <Button onClick={reset}>{t('common.cancel')}</Button>
                <Button
                  icon={<CloudSyncOutlined />}
                  loading={testing}
                  onClick={onTestConnection}
                >
                  {t('pages.shopBind.testConnection')}
                </Button>
                <Button
                  type="primary"
                  disabled={!testResult?.ok}
                  onClick={onSubmitInfo}
                >
                  {t('pages.shopBind.nextStep')}
                </Button>
              </Space>
            </Form>
          </>
        )}

        {current === 2 && (
          <div>
            <Alert
              type="info"
              message={t('pages.shopBind.alertBeforeSubmitTitle')}
              description={t('pages.shopBind.alertBeforeSubmitDesc')}
              showIcon
              style={{ marginBottom: 16 }}
            />
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label={t('pages.shopBind.descShopName')}>{formValues.name}</Descriptions.Item>
              <Descriptions.Item label={t('pages.shopBind.descPlatformShopId')}>{formValues.shopId}</Descriptions.Item>
              <Descriptions.Item label={t('pages.shopBind.descPlatformRegion')}>
                <Tag color="blue">{selectedPlatform.name}</Tag>
                <Tag color="cyan">
                  {cfg.regions.find((r) => r.code === formValues.region)?.name}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label={t('pages.shopBind.descCredentialCount')}>
                {t('pages.shopBind.descCredentialCountValue', { count: credFields.length })}
              </Descriptions.Item>
              <Descriptions.Item label={t('pages.shopBind.descCredentialSummary')} span={2}>
                {credFields
                  .filter((f) => formValues[f.name])
                  .map((f) => `${f.label}: ${'*'.repeat(8)}`)
                  .join(' · ')}
              </Descriptions.Item>
              {formValues.remark && (
                <Descriptions.Item label={t('pages.shopBind.formRemark')} span={2}>{formValues.remark}</Descriptions.Item>
              )}
            </Descriptions>
            <Space style={{ marginTop: 16 }}>
              <Button onClick={() => setCurrent(1)}>{t('pages.shopBind.prevStep')}</Button>
              <Button type="primary" loading={loading} onClick={onConfirmAuth}>
                {t('common.confirm')}
              </Button>
            </Space>
          </div>
        )}

        {current === 3 && authedShop && (
          <Result
            status="success"
            title={t('pages.shopBind.resultTitle')}
            subTitle={t('pages.shopBind.resultSubtitle', { name: authedShop.name })}
            extra={[
              <Button key="sync" type="primary" onClick={() => navigate('/auth/sync')}>
                {t('pages.shopBind.resultSyncData')}
              </Button>,
              <Button key="shop" onClick={() => navigate('/auth/shop')}>
                {t('pages.shopBind.resultViewShop')}
              </Button>,
              <Button key="again" onClick={reset}>
                {t('pages.shopBind.resultAgain')}
              </Button>,
            ]}
          >
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label={t('pages.shopBind.descShop')}>{authedShop.name}</Descriptions.Item>
              <Descriptions.Item label={t('pages.shopBind.descPlatform')}>{authedShop.platform}</Descriptions.Item>
              <Descriptions.Item label={t('pages.shopBind.descRegion')}>{authedShop.region}</Descriptions.Item>
              <Descriptions.Item label={t('common.currency')}>{authedShop.currency}</Descriptions.Item>
              <Descriptions.Item label="Access Token" span={2}>
                <code style={{ fontSize: 12 }}>{authedShop.accessToken}</code>
              </Descriptions.Item>
              <Descriptions.Item label={t('pages.shopBind.descExpiresAt')} span={2}>{authedShop.tokenExpiresAt}</Descriptions.Item>
            </Descriptions>
          </Result>
        )}
      </Card>
    </div>
  );
}
