import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
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
  { value: 1, label: '在售', color: 'green' },
  { value: 0, label: '下架', color: 'default' },
  { value: 2, label: '违规', color: 'red' },
];

const CURRENCIES = ['USD', 'CNY', 'EUR', 'GBP', 'JPY', 'HKD', 'SGD', 'AUD', 'CAD', 'MYR', 'THB', 'VND', 'BRL'];

export default function ProductEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
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
      message.success('创建成功');
      qc.invalidateQueries({ queryKey: ['products'] });
      goBack();
    },
  });
  const updateMut = useMutation({
    mutationFn: (vars: { id: string; data: any }) => productApi.update(vars.id, vars.data),
    onSuccess: () => {
      message.success('更新成功');
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
      message.warning('请完善表单必填项后再保存');
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
          { title: '商品' },
          { title: <a onClick={() => navigate('/product/sku/list')}>SKU 列表</a> },
          { title: isEdit ? '编辑商品' : '新增商品' },
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
            {isEdit ? `编辑商品${detail?.sku ? ' · ' + detail.sku : ''}` : '新增商品'}
          </Title>
        </Space>
        <Space>
          <Button icon={<CloseOutlined />} onClick={goBack}>
            取消
          </Button>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            loading={saving}
            onClick={onSubmit}
          >
            保 存
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
                      <TagsOutlined /> 基本信息
                    </span>
                  ),
                  children: (
                    <Row gutter={16}>
                      <Col span={12}>
                        <Form.Item
                          name="sku"
                          label="SKU 编码"
                          rules={[{ required: true, message: '请输入 SKU' }]}
                          extra={isEdit ? 'SKU 创建后不可修改' : undefined}
                        >
                          <Input placeholder="例如 SKU-10001" disabled={isEdit} style={inputStyle} />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="name" label="商品名称" rules={[{ required: true, message: '请输入商品名称' }]}>
                          <Input placeholder="商品名称" style={inputStyle} maxLength={200} showCount />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="category" label="商品类目">
                          <Input placeholder="例如 手机壳 / 配件" style={inputStyle} />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="brand" label="品牌">
                          <Input placeholder="品牌名称" style={inputStyle} />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="status" label="商品状态" initialValue={1}>
                          <Select
                            options={STATUS.map((s) => ({ label: `${s.label}`, value: s.value }))}
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
                      <DollarOutlined /> 价格与库存
                    </span>
                  ),
                  children: (
                    <Row gutter={16}>
                      <Col span={12}>
                        <Form.Item name="costPrice" label="成本价" tooltip="商品采购成本, 用于利润计算">
                          <InputNumber min={0} step={0.01} style={inputStyle} addonAfter={form.getFieldValue('currency') || 'USD'} />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="salePrice" label="售价" rules={[{ required: true, message: '请输入售价' }]}>
                          <InputNumber min={0} step={0.01} style={inputStyle} addonAfter={form.getFieldValue('currency') || 'USD'} />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="currency" label="币种" initialValue="USD">
                          <Select
                            options={CURRENCIES.map((c) => ({ label: c, value: c }))}
                            style={inputStyle}
                            onChange={() => form.setFieldsValue(form.getFieldsValue())}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={24}>
                        <Divider titlePlacement="left" orientationMargin={0} plain style={{ fontSize: 13, color: '#86909C' }}>
                          成本利润参考
                        </Divider>
                        <Descriptions size="small" column={3} bordered>
                          <Descriptions.Item label="毛利额">
                            <Text type={+form.getFieldValue('salePrice') - +form.getFieldValue('costPrice') >= 0 ? 'success' : 'danger'}>
                              {((+form.getFieldValue('salePrice') || 0) - (+form.getFieldValue('costPrice') || 0)).toFixed(2)}
                            </Text>
                          </Descriptions.Item>
                          <Descriptions.Item label="毛利率">
                            <Text type="success">
                              {(() => {
                                const s = +form.getFieldValue('salePrice') || 0;
                                const c = +form.getFieldValue('costPrice') || 0;
                                return s > 0 ? (((s - c) / s) * 100).toFixed(1) + '%' : '-';
                              })()}
                            </Text>
                          </Descriptions.Item>
                          <Descriptions.Item label="库存数量">
                            <Text>{detail?.stock ?? '见库存模块'}</Text>
                          </Descriptions.Item>
                        </Descriptions>
                        <div style={{ marginTop: 8 }}>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            库存请在「仓库管理 → 库存清单」中按仓库维护
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
                      <CarOutlined /> 物流信息
                    </span>
                  ),
                  children: (
                    <Row gutter={16}>
                      <Col span={12}>
                        <Form.Item name="weight" label="重量 (kg)">
                          <InputNumber min={0} step={0.01} style={inputStyle} placeholder="0.00" />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="length" label="长度 (cm)">
                          <InputNumber min={0} step={0.1} style={inputStyle} placeholder="0.0" />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="width" label="宽度 (cm)">
                          <InputNumber min={0} step={0.1} style={inputStyle} placeholder="0.0" />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="height" label="高度 (cm)">
                          <InputNumber min={0} step={0.1} style={inputStyle} placeholder="0.0" />
                        </Form.Item>
                      </Col>
                      <Col span={24}>
                        <Alert
                          type="info"
                          showIcon
                          message="重量与尺寸将用于运费预估、物流渠道匹配及海关申报"
                        />
                      </Col>
                    </Row>
                  ),
                },
                {
                  key: 'media',
                  label: (
                    <span>
                      <PictureOutlined /> 图片与描述
                    </span>
                  ),
                  children: (
                    <Row gutter={16}>
                      <Col span={24}>
                        <Form.Item name="image" label="主图 URL">
                          <Input placeholder="https://..." style={inputStyle} />
                        </Form.Item>
                      </Col>
                      <Col span={24}>
                        <Form.Item shouldUpdate={(prev, cur) => prev.image !== cur.image} label="主图预览">
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
                                暂无图片
                              </div>
                            )
                          }
                        </Form.Item>
                      </Col>
                      <Col span={24}>
                        <Form.Item name="description" label="商品描述">
                          <Input.TextArea
                            rows={8}
                            placeholder="商品详细描述, 支持多平台商品刊登"
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
                <Button onClick={goBack}>取消</Button>
                <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={onSubmit}>
                  保 存
                </Button>
              </Space>
            </div>
          </Form>
        )}
      </Card>
    </div>
  );
}