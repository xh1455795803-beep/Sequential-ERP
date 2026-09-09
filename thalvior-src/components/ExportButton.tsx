// 通用导出按钮组件
// - 支持 Excel / PDF / CSV 三种格式
// - 通过下拉菜单选择导出格式
// - 弹出"导出中"提示
import { useState } from 'react';
import { Button, Dropdown, message, Modal, Space, Progress, Typography, Alert } from 'antd';
import {
  DownloadOutlined,
  FileExcelOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  DownOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import { post } from '../api/http';
import { useAuthStore } from '../store/auth';

const { Text } = Typography;

export interface ExportButtonProps {
  // 导出类型: 决定请求接口
  type: 'orders' | 'products' | 'inventory' | 'finance' | 'custom';
  // 筛选条件
  filters?: any;
  // 自定义导出配置 (type=custom 时必填)
  config?: {
    title?: string;
    filename?: string;
    data?: any[];
    columns?: { header: string; key: string; width?: number }[];
    sheetName?: string;
  };
  // 按钮文字
  text?: string;
  // 按钮类型
  variant?: 'primary' | 'default' | 'dashed' | 'text' | 'link';
  // 尺寸
  size?: 'small' | 'middle' | 'large';
  // 是否禁用
  disabled?: boolean;
  // 是否显示下拉 (false 则只能导出 Excel)
  showAllFormats?: boolean;
}

const API_BASE = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:3000/api';

export function ExportButton({
  type,
  filters,
  config,
  text = '导出',
  variant = 'default',
  size = 'middle',
  disabled,
  showAllFormats = true,
}: ExportButtonProps) {
  const { token } = useAuthStore();
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ ok: boolean; filename?: string; error?: string } | null>(null);

  const exportMut = useMutation({
    mutationFn: async (format: 'excel' | 'pdf' | 'csv') => {
      setOpen(true);
      setProgress(20);
      setResult(null);

      const body: any = { format, filters };
      if (type === 'custom') body.config = config || {};
      const path = `/export/${type}`;

      setProgress(40);
      // 用 fetch 直接处理二进制
      const res = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      setProgress(70);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(err.message || `HTTP ${res.status}`);
      }

      // 从 Content-Disposition 拿文件名
      const cd = res.headers.get('content-disposition') || '';
      const m = cd.match(/filename="?([^"]+)"?/);
      const filename = m ? decodeURIComponent(m[1]) : `export.${format === 'excel' ? 'xlsx' : format}`;

      const blob = await res.blob();
      setProgress(95);

      // 触发下载
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setProgress(100);
      return { filename };
    },
    onSuccess: (data) => {
      setResult({ ok: true, filename: data.filename });
    },
    onError: (e: any) => {
      setResult({ ok: false, error: e?.message || '导出失败' });
    },
  });

  const closeModal = () => {
    setOpen(false);
    setProgress(0);
    setResult(null);
  };

  // 仅 Excel
  if (!showAllFormats) {
    return (
      <>
        <Button
          type={variant}
          size={size}
          icon={<DownloadOutlined />}
          loading={exportMut.isPending}
          disabled={disabled}
          onClick={() => exportMut.mutate('excel')}
        >
          {text}
        </Button>
        {open && <ProgressModal open={open} progress={progress} result={result} onClose={closeModal} />}
      </>
    );
  }

  const items = [
    {
      key: 'excel',
      icon: <FileExcelOutlined style={{ color: '#52c41a' }} />,
      label: '导出 Excel (.xlsx)',
    },
    {
      key: 'pdf',
      icon: <FilePdfOutlined style={{ color: '#ff4d4f' }} />,
      label: '导出 PDF',
    },
    {
      key: 'csv',
      icon: <FileTextOutlined style={{ color: '#1677ff' }} />,
      label: '导出 CSV',
    },
  ];

  return (
    <>
      <Dropdown
        menu={{
          items,
          onClick: ({ key }) => exportMut.mutate(key as any),
        }}
        trigger={['click']}
      >
        <Button
          type={variant}
          size={size}
          icon={<DownloadOutlined />}
          loading={exportMut.isPending}
          disabled={disabled}
        >
          <Space>
            {text}
            <DownOutlined />
          </Space>
        </Button>
      </Dropdown>
      {open && <ProgressModal open={open} progress={progress} result={result} onClose={closeModal} />}
    </>
  );
}

function ProgressModal({ open, progress, result, onClose }: {
  open: boolean;
  progress: number;
  result: { ok: boolean; filename?: string; error?: string } | null;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      title="报表导出"
      onCancel={onClose}
      footer={null}
      closable={!!result}
      maskClosable={!!result}
    >
      {!result && (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Text>正在导出数据, 请稍候...</Text>
          <Progress percent={progress} status="active" />
        </Space>
      )}
      {result?.ok && (
        <Alert
          type="success"
          showIcon
          icon={<CheckCircleOutlined />}
          message={
            <Space direction="vertical">
              <Text strong>导出成功!</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>{result.filename}</Text>
            </Space>
          }
        />
      )}
      {result && !result.ok && (
        <Alert type="error" showIcon message={result.error} />
      )}
    </Modal>
  );
}
