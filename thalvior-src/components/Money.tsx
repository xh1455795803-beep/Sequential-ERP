// Money 组件: 显示货币金额
// - 原币种 + 目标币种 (可选): 同时显示原币种和换算后币种
// - 自动加载汇率并换算
// - 支持简单 / 详细两种模式
import { Space, Tag, Tooltip, Typography } from 'antd';
import { SwapOutlined } from '@ant-design/icons';
import { useCurrencyConverter, formatMoney, getCurrencyMeta } from '../hooks/useCurrency';

const { Text } = Typography;

export interface MoneyProps {
  amount: number | string;
  currency?: string;             // 原币种
  targetCurrency?: string;       // 目标币种 (如设置则换算)
  locale?: string;
  showOriginal?: boolean;        // 同时显示原币种
  precision?: number;            // 小数位 (默认 2)
  prefix?: React.ReactNode;
  style?: React.CSSProperties;
}

export function Money({
  amount,
  currency = 'CNY',
  targetCurrency,
  locale = 'zh-CN',
  showOriginal = true,
  style,
}: MoneyProps) {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num)) return <Text type="secondary">-</Text>;

  // 如果不需要换算
  if (!targetCurrency || targetCurrency === currency) {
    return (
      <Text strong style={style}>
        {formatMoney(num, currency, locale)}
      </Text>
    );
  }

  // 需要换算
  return (
    <ConvertedMoney
      amount={num}
      from={currency}
      to={targetCurrency}
      locale={locale}
      showOriginal={showOriginal}
    />
  );
}

interface ConvertedMoneyProps {
  amount: number;
  from: string;
  to: string;
  locale: string;
  showOriginal: boolean;
}

function ConvertedMoney({ amount, from, to, locale, showOriginal }: ConvertedMoneyProps) {
  const { data, isLoading, error } = useCurrencyConverter(amount, from, to);

  if (isLoading) {
    return (
      <Text type="secondary" style={{ fontSize: 12 }}>
        换算中...
      </Text>
    );
  }

  if (error || !data) {
    return (
      <Text strong>
        {formatMoney(amount, from, locale)}
      </Text>
    );
  }

  const fromMeta = getCurrencyMeta(from);
  const toMeta = getCurrencyMeta(to);

  return (
    <Space size={4} wrap>
      <Text strong style={{ fontSize: 14 }}>
        {formatMoney(data.converted, to, locale)}
      </Text>
      {showOriginal && from !== to && (
        <Tooltip
          title={
            <Space size={4} direction="vertical" style={{ fontSize: 12 }}>
              <span>原币种: {amount.toFixed(2)} {from}</span>
              <span>汇率: ×{data.rate.toFixed(4)}</span>
              <span>路径: {data.path.join(' → ')}</span>
            </Space>
          }
        >
          <Tag color="default" style={{ fontSize: 11, margin: 0, cursor: 'help' }}>
            <SwapOutlined /> {amount.toFixed(2)} {fromMeta?.symbol}{from}
          </Tag>
        </Tooltip>
      )}
    </Space>
  );
}

// 简易内联格式化组件
export function MoneyText({
  amount,
  currency = 'CNY',
  locale = 'zh-CN',
}: { amount: number | string; currency?: string; locale?: string }) {
  return <>{formatMoney(amount, currency, locale)}</>;
}
