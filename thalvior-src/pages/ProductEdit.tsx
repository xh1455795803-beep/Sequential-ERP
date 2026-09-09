import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from '../i18n';
import {
  Card,
  Form,
  Input,
  InputNumber,
  Select,
  Row,
  Col,
  Button,
  Space,
  Typography,
  Tabs,
  Divider,
  Descriptions,
  Breadcrumb,
  Image,
  message,
  Spin,
  Alert,
} from 'antd';
import {
  ArrowLeftOutlined,
  TagsOutlined,
  DollarOutlined,
  CarOutlined,
  PictureOutlined,
  SaveOutlined,
  CloseOutlined,
} from '@ant-design/icons';
import { productApi } from '../api';

const { Title, Text } = Typography;

const STATUS = [
  { value: 1, labelKey: 'pages.productEdit.statusOnSale', color: 'green' },
  { value: 0, labelKey: 'pages.productEdit.statusOffSale', color: 'default' },
  { value: 2, labelKey: 'pages.productEdit.statusViolation', color: 'red' },
];

const CURRENCIES = ['USD', 'CNY', 'EUR', 'GBP', 'JPY', 'HKD', 'SGD', 'AUD', 'CAD', 'MYR', 'THB', 'VND', 'BRL'];

export default function ProductEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [activeTab, setActiveTab] = useState('basic');

  const isEdit = !!id && id !== 'new';
  const goBack = () => navigate('/product/sku/list');

  // 编辑模式: 加载详情
  const { data: detail, isLoading } = useQuery({
    queryKey: ['product', id],
    queryFn: () => productApi.detail(id!),
    enabled: isEdit,
  });

  // 详情加载完成后回填表单
  useEffect(() => {
    if (isEdit && detail) {
      form.setFieldsValue(detail);
    } else if (!isEdit) {
      form.resetFields();
      form.setFieldsValue({ status: 1, currency: 'USD' });
    }
  }, [isEdit, detail, form]);

  const createMut = useMutation({
    mutationFn: productApi.create,
    onSuccess: () => {
      message.success(t('pages.productEdit.msgCreateSuccess'));
      qc.invalidateQueries({ queryKey: ['products'] });
      goBack();
    },
  });
  const updateMut = useMutation({
    mutationFn: (vars: { id: string; data: any }) => productApi.update(vars.id, vars.data),
    onSuccess: () => {
      message.success(t('pages.productEdit.msgUpdateSuccess'));
      qc.invalidateQueries({ queryKey: ['products'] });
      goBack();
    },
  });

  const onSubmit = async () => {
    try {
      const vals = await form.validateFields();
      const cleaned: any = {};
      for (const [k, v] of Object.entries(vals)) {
        if (v !== undefined && v !== null && v !== '') cleaned[k] = v;
      }
      if (isEdit) {
        updateMut.mutate({ id: id!, data: cleaned });
      } else {
        createMut.mutate(cleaned);
      }
    } catch (e) {
      message.warning(t('pages.productEdit.msgValidateWarning'));
      setActiveTab('basic');
    }
  };

  const inputStyle = { width: '100%' };
  const saving = createMut.isPending || updateMut.isPending;

  return (
    <div>
      <Breadcrumb
        style={{ marginBottom: 4 }}
        items={[
          { title: t('pages.productEdit.breadcrumbProduct') },
          { title: <a onClick={() => navigate('/product/sku/list')}>{t('pages.productEdit.breadcrumbSkuList')}</a> },
          { title: isEdit ? t('pages.productEdit.breadcrumbEdit') : t('pages.productEdit.breadcrumbCreate') },
        ]}
      />

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <Space align="center">
          <Button type="text" icon={<ArrowLeftOutlined />} onClick={goBack} />
          <Title level={4} style={{ margin: 0 }}>
            {isEdit
              ? detail?.sku
                ? t('pages.productEdit.titleEdit', { sku: detail.sku })
                : t('pages.productEdit.titleEditBasic')
              : t('pages.productEdit.titleCreate')}
          </Title>
        </Space>
        <Space>
          <Button icon={<CloseOutlined />} onClick={goBack}>
            {t('pages.productEdit.cancel')}
          </Button>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            loading={saving}
            onClick={onSubmit}
          >
            {t('pages.productEdit.save')}
          </Button>
        </Space>
      </div>

      <Card bordered={false}>
        {isEdit && isLoading ? (
          <div style={{ textAlign: 'center', padding: 80 }}>
            <Spin size="large" />
          </div>
        ) : (
          <Form form={form} layout="vertical" requiredMark={false}>
            <Tabs
              activeKey={activeTab}
              onChange={setActiveTab}
              items={[
                {
                  key: 'basic',
                  label: (
                    <span>
                      <TagsOutlined /> {t('pages.productEdit.tabBasic')}
                    </span>
                  ),
                  children: (
                    <Row gutter={16}>
                      <Col span={12}>
                        <Form.Item
                          name="sku"
                          label={t('pages.productEdit.labelSkuCode')}
                          rules={[{ required: true, message: t('pages.productEdit.ruleSkuRequired') }]}
                          extra={isEdit ? t('pages.productEdit.extraSkuImmutable') : undefined}
                        >
                          <Input placeholder={t('pages.productEdit.placeholderSkuExample')} disabled={isEdit} style={inputStyle} />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="name" label={t('pages.productEdit.labelProductName')} rules={[{ required: true, message: t('pages.productEdit.ruleProductNameRequired') }]}>
                          <Input placeholder={t('pages.productEdit.placeholderProductName')} style={inputStyle} maxLength={200} showCount />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="category" label={t('pages.productEdit.labelCategory')}>
                          <Input placeholder={t('pages.productEdit.placeholderCategory')} style={inputStyle} />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="brand" label={t('pages.productEdit.labelBrand')}>
                          <Input placeholder={t('pages.productEdit.placeholderBrand')} style={inputStyle} />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="status" label={t('pages.productEdit.labelStatus')} initialValue={1}>
                          <Select
                            options={STATUS.map((s) => ({ label: t(s.labelKey), value: s.value }))}
                            style={inputStyle}
                          />
                        </Form.Item>
                      </Col>
                    </Row>
                  ),
                },
                {
                  key: 'price',
                  label: (
                    <span>
                      <DollarOutlined /> {t('pages.productEdit.tabPriceStock')}
                    </span>
                  ),
                  children: (
                    <Row gutter={16}>
                      <Col span={12}>
                        <Form.Item name="costPrice" label={t('pages.productEdit.labelCostPrice')} tooltip={t('pages.productEdit.tooltipCostPrice')}>
                          <InputNumber min={0} step={0.01} style={inputStyle} addonAfter={form.getFieldValue('currency') || 'USD'} />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="salePrice" label={t('pages.productEdit.labelSalePrice')} rules={[{ required: true, message: t('pages.productEdit.ruleSalePriceRequired') }]}>
                          <InputNumber min={0} step={0.01} style={inputStyle} addonAfter={form.getFieldValue('currency') || 'USD'} />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="currency" label={t('pages.productEdit.labelCurrency')} initialValue="USD">
                          <Select
                            options={CURRENCIES.map((c) => ({ label: c, value: c }))}
                            style={inputStyle}
                            onChange={() => form.setFieldsValue(form.getFieldsValue())}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={24}>
                        <Divider titlePlacement="left" orientationMargin={0} plain style={{ fontSize: 13, color: '#86909C' }}>
                          {t('pages.productEdit.dividerProfitRef')}
                        </Divider>
                        <Descriptions size="small" column={3} bordered>
                          <Descriptions.Item label={t('pages.productEdit.profitAmount')}>
                            <Text type={+form.getFieldValue('salePrice') - +form.getFieldValue('costPrice') >= 0 ? 'success' : 'danger'}>
                              {((+form.getFieldValue('salePrice') || 0) - (+form.getFieldValue('costPrice') || 0)).toFixed(2)}
                            </Text>
                          </Descriptions.Item>
                          <Descriptions.Item label={t('pages.productEdit.profitRate')}>
                            <Text type="success">
                              {(() => {
                                const s = +form.getFieldValue('salePrice') || 0;
                                const c = +form.getFieldValue('costPrice') || 0;
                                return s > 0 ? (((s - c) / s) * 100).toFixed(1) + '%' : '-';
                              })()}
                            </Text>
                          </Descriptions.Item>
                          <Descriptions.Item label={t('pages.productEdit.stockQuantity')}>
                            <Text>{detail?.stock ?? t('pages.productEdit.seeStockModule')}</Text>
                          </Descriptions.Item>
                        </Descriptions>
                        <div style={{ marginTop: 8 }}>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {t('pages.productEdit.stockHint')}
                          </Text>
                        </div>
                      </Col>
                    </Row>
                  ),
                },
                {
                  key: 'logistics',
                  label: (
                    <span>
                      <CarOutlined /> {t('pages.productEdit.tabLogistics')}
                    </span>
                  ),
                  children: (
                    <Row gutter={16}>
                      <Col span={12}>
                        <Form.Item name="weight" label={t('pages.productEdit.labelWeight')}>
                          <InputNumber min={0} step={0.01} style={inputStyle} placeholder="0.00" />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="length" label={t('pages.productEdit.labelLength')}>
                          <InputNumber min={0} step={0.1} style={inputStyle} placeholder="0.0" />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="width" label={t('pages.productEdit.labelWidth')}>
                          <InputNumber min={0} step={0.1} style={inputStyle} placeholder="0.0" />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="height" label={t('pages.productEdit.labelHeight')}>
                          <InputNumber min={0} step={0.1} style={inputStyle} placeholder="0.0" />
                        </Form.Item>
                      </Col>
                      <Col span={24}>
                        <Alert
                          type="info"
                          showIcon
                          message={t('pages.productEdit.alertDimension')}
                        />
                      </Col>
                    </Row>
                  ),
                },
                {
                  key: 'media',
                  label: (
                    <span>
                      <PictureOutlined /> {t('pages.productEdit.tabMedia')}
                    </span>
                  ),
                  children: (
                    <Row gutter={16}>
                      <Col span={24}>
                        <Form.Item name="image" label={t('pages.productEdit.labelMainImageUrl')}>
                          <Input placeholder="https://..." style={inputStyle} />
                        </Form.Item>
                      </Col>
                      <Col span={24}>
                        <Form.Item shouldUpdate={(prev, cur) => prev.image !== cur.image} label={t('pages.productEdit.labelMainImagePreview')}>
                          {({ getFieldValue }) =>
                            getFieldValue('image') ? (
                              <Image
                                src={getFieldValue('image')}
                                width={120}
                                height={120}
                                style={{ borderRadius: 8, objectFit: 'cover' }}
                              />
                            ) : (
                              <div
                                style={{
                                  width: 120,
                                  height: 120,
                                  borderRadius: 8,
                                  background: '#F7F8FA',
                                  border: '1px dashed #D5D8DE',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  color: '#86909C',
                                  fontSize: 12,
                                }}
                              >
                                {t('pages.productEdit.noImage')}
                              </div>
                            )
                          }
                        </Form.Item>
                      </Col>
                      <Col span={24}>
                        <Form.Item name="description" label={t('pages.productEdit.labelDescription')}>
                          <Input.TextArea
                            rows={8}
                            placeholder={t('pages.productEdit.placeholderDescription')}
                            maxLength={2000}
                            showCount
                          />
                        </Form.Item>
                      </Col>
                    </Row>
                  ),
                },
              ]}
            />

            <Divider />

            <div style={{ textAlign: 'right' }}>
              <Space>
                <Button onClick={goBack}>{t('pages.productEdit.cancel')}</Button>
                <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={onSubmit}>
                  {t('pages.productEdit.save')}
                </Button>
              </Space>
            </div>
          </Form>
        )}
      </Card>
    </div>
  );
}