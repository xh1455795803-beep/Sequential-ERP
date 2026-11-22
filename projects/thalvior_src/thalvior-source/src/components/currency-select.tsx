import { CURRENCIES } from "@/lib/currencies";
import { useLanguage } from "@/i18n/LanguageContext";

const SELECT_CLS =
  "h-8 rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring";

interface Props {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}

// 通用币种下拉选择器：全站金额输入统一使用
export function CurrencySelect({ value, onChange, className }: Props) {
  const { t } = useLanguage();
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={className ?? SELECT_CLS}>
      {CURRENCIES.map((c) => {
        // 币种名 i18n：key 未命中（理论上不会）回退 DB 中文名
        const k = `common.currency.${c.code.toLowerCase()}`;
        const name = t(k) === k ? c.name : t(k);
        return (
          <option key={c.code} value={c.code}>
            {c.code} · {name}
          </option>
        );
      })}
    </select>
  );
}
