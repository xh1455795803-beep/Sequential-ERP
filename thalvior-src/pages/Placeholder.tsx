import { Card, Typography, Space, Tag, Button, Result } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeftOutlined, BulbOutlined, CodeOutlined } from '@ant-design/icons';
import { menuConfig, type MenuNode } from '../menu/menuConfig';

const { Title, Paragraph, Text } = Typography;

// 根据 path 反查菜单节点
function findNode(nodes: MenuNode[], path: string): MenuNode | null {
  for (const n of nodes) {
    if (n.path === path) return n;
    if (n.children) {
      const r = findNode(n.children, path);
      if (r) return r;
    }
  }
  return null;
}

function getBreadcrumb(path: string): string[] {
  const parts: string[] = [];
  const segs = path.split('/').filter(Boolean);
  let acc = '';
  for (const s of segs) {
    acc += '/' + s;
    const n = findNode(menuConfig, acc);
    if (n) parts.push(n.label);
  }
  return parts;
}

export default function Placeholder() {
  const loc = useLocation();
  const nav = useNavigate();
  const node = findNode(menuConfig, loc.pathname);
  const crumbs = getBreadcrumb(loc.pathname);

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>
        {node?.label || '未命名页面'}
      </Title>
      <Space size={4} style={{ marginBottom: 16 }}>
        {crumbs.map((c, i) => (
          <Space key={i} size={4}>
            {i > 0 && <Text type="secondary">/</Text>}
            <Tag color={i === crumbs.length - 1 ? 'blue' : 'default'}>{c}</Tag>
          </Space>
        ))}
      </Space>

      <Card bordered={false}>
        <Result
          icon={<BulbOutlined style={{ color: '#1677ff' }} />}
          title="该功能页面正在建设中"
          subTitle={`路径: ${loc.pathname} · 后续将按里程碑逐步实现`}
          extra={
            <Space>
              <Button icon={<ArrowLeftOutlined />} onClick={() => nav('/workbench/overview')}>
                返回工作台
              </Button>
              <Button type="primary" icon={<CodeOutlined />}>
                查看 API 契约
              </Button>
            </Space>
          }
        >
          <Paragraph type="secondary" style={{ marginTop: 12 }}>
            当前已落地：主导航 / 布局 / 工作台 / 订单列表 / 利润报表<br />
            占位页面已自动接入全部菜单节点, 后续可一键替换为真实业务页面。
          </Paragraph>
        </Result>
      </Card>
    </div>
  );
}
