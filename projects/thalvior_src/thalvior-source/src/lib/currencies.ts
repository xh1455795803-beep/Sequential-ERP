// 全站共享币种表：跨境业务常用币种
export interface Currency {
  code: string;
  name: string;
  symbol: string;
}

export const CURRENCIES: Currency[] = [
  { code: "USD", name: "美元", symbol: "$" },
  { code: "EUR", name: "欧元", symbol: "€" },
  { code: "GBP", name: "英镑", symbol: "£" },
  { code: "JPY", name: "日元", symbol: "JP¥" },
  { code: "CNY", name: "人民币", symbol: "¥" },
  { code: "AUD", name: "澳元", symbol: "A$" },
  { code: "CAD", name: "加元", symbol: "C$" },
  { code: "HKD", name: "港币", symbol: "HK$" },
  { code: "SGD", name: "新加坡元", symbol: "S$" },
  { code: "NZD", name: "新西兰元", symbol: "NZ$" },
  { code: "KRW", name: "韩元", symbol: "₩" },
  { code: "TWD", name: "新台币", symbol: "NT$" },
  { code: "THB", name: "泰铢", symbol: "฿" },
  { code: "VND", name: "越南盾", symbol: "₫" },
  { code: "IDR", name: "印尼盾", symbol: "Rp" },
  { code: "MYR", name: "林吉特", symbol: "RM" },
  { code: "PHP", name: "菲律宾比索", symbol: "₱" },
  { code: "INR", name: "印度卢比", symbol: "₹" },
  { code: "AED", name: "阿联酋迪拉姆", symbol: "AED" },
  { code: "SAR", name: "沙特里亚尔", symbol: "SAR" },
  { code: "TRY", name: "土耳其里拉", symbol: "₺" },
  { code: "RUB", name: "俄罗斯卢布", symbol: "₽" },
  { code: "PLN", name: "波兰兹罗提", symbol: "zł" },
  { code: "BRL", name: "巴西雷亚尔", symbol: "R$" },
  { code: "MXN", name: "墨西哥比索", symbol: "MX$" },
  { code: "ZAR", name: "南非兰特", symbol: "ZAR" },
  { code: "SEK", name: "瑞典克朗", symbol: "kr" },
  { code: "NOK", name: "挪威克朗", symbol: "kr" },
  { code: "CHF", name: "瑞士法郎", symbol: "CHF" },
];

export function currencySymbol(code: string): string {
  return CURRENCIES.find((c) => c.code === code)?.symbol ?? code;
}
