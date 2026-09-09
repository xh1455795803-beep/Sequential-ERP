// SensitiveConfirm - 敏感操作二次确认弹窗
// 用法:
//   1. 把原 onClick 改成 onClick={() => setOpen(true)}
//   2. <SensitiveConfirm open={open} config={...} onOk={...} onClose={...} />
import { Alert, Input, Modal, Space, Typography, message } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { confirmApi } from '../api';

const { Text } = Typography;

export interface SensitiveConfirmConfig {
  action: string;                          // e.g. 'order.refund'
  description?: string;                    // 顶部说明
  /** 用户必须输入的确认文字 (默认是 description 里取关键字) */
  keyword?: string;
  /** payload, 用于绑定到 confirm token */
  payload: Record<string, any>;
  /** 是否显示金额等关键信息 (用于强化警示) */
  highlight?: Array<{ label: string; value: any; danger?: boolean }>;
  /** 倒计时秒数, 0 表示不倒计时 */
  countdownSec?: number;
}

interface Props {
  open: boolean;
  config: SensitiveConfirmConfig | null;
  onClose: () => void;
  /** 拿到 confirm token 后的回调, 由调用方继续执行业务请求 */
  onOk: (token: string) => Promise<void> | void;
}

export default function SensitiveConfirm({ open, config, onClose, onOk }: Props) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // 关键字: 用户需要输入的确认词
  const keyword = useMemo(() => {
    if (config?.keyword) return config.keyword;
    if (config?.description) {
      // 提取 description 中第一个数字/单词作为关键字
      const m = config.description.match(/[A-Z0-9]{3,}/);
      if (m) return m[0];
    }
    return 'CONFIRM';
  }, [config]);

  // 倒计时
  useEffect(() => {
    if (!open) return;
    setInput('');
    setError(null);
    setToken(null);
    setCountdown(config?.countdownSec ?? 3);
  }, [open, config?.countdownSec]);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  // 申请 token
  const applyToken = async () => {
    if (!config) return;
    setLoading(true);
    setError(null);
    try {
      const r = await confirmApi.prepare({
        action: config.action,
        payload: config.payload,
        description: config.description,
      });
      setToken(r.token);
    } catch (e: any) {
      setError(e?.message || '申请确认 token 失败');
    } finally {
      setLoading(false);
    }
  };

  // 自动在打开时申请 token
  useEffect(() => {
    if (open && config && !token && !error) {
      applyToken();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, config]);

  const inputOk = input.trim().toUpperCase() === keyword.toUpperCase();
  const canSubmit = token && inputOk && countdown === 0;

  const handleOk = async () => {
    if (!token) {
      setError('确认 token 未就绪');
      return;
    }
    if (!inputOk) {
      setError(`请输入确认文字: ${keyword}`);
      return;
    }
    setLoading(true);
    try {
      await onOk(token);
      // 成功后 onClose
    } catch (e: any) {
      setError(e?.message || '操作失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={
        <Space>
          <span style={{ color: '#ff4d4f' }}>⚠</span>
          <span>敏感操作二次确认</span>
        </Space>
      }
      open={open}
      onCancel={onClose}
      okText={countdown > 0 ? `请等待 ${countdown}s` : '确认执行'}
      cancelText="取消"
      okButtonProps={{
        danger: true,
        disabled: !canSubmit,
        loading,
      }}
      onOk={handleOk}
      width={520}
      destroyOnClose
    >
      {config?.description && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={config.description}
        />
      )}

      {config?.highlight && config.highlight.length > 0 && (
        <div
          style={{
            background: '#fffbe6',
            border: '1px solid #ffe58f',
            padding: 12,
            borderRadius: 4,
            marginBottom: 16,
          }}
        >
          {config.highlight.map((h, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
              <Text type="secondary">{h.label}</Text>
              <Text strong style={{ color: h.danger ? '#ff4d4f' : undefined }}>
                {String(h.value)}
              </Text>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginBottom: 12 }}>
        <Text>请输入 <Text strong code>{keyword}</Text> 以确认此操作：</Text>
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`输入 ${keyword}`}
          style={{ marginTop: 8 }}
          autoFocus
          // 不让用户按回车直接提交
          onPressEnter={(e) => e.preventDefault()}
        />
      </div>

      {error && (
        <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />
      )}

      <div style={{ fontSize: 12, color: '#999' }}>
        {token ? (
          <span style={{ color: '#52c41a' }}>● 确认 token 已申请 (5 分钟内有效)</span>
        ) : loading ? (
          <span>● 正在申请确认 token...</span>
        ) : (
          <span style={{ color: '#ff4d4f' }}>● 确认 token 申请失败</span>
        )}
      </div>
    </Modal>
  );
}
