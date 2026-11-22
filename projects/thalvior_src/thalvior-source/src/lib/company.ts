/**
 * 合规主体信息（wave B 20261117）
 * 站点所有法务展示位统一从这里取值，避免多处硬编码。
 * 构建期注入：VITE_* 常量（见 /opt/thalvior-source/.env.example）。
 * 未填写时渲染中文占位文案，便于上线前肉眼发现缺口（不要填假数据）。
 * 一次性填充脚本：ops/scripts/fill-legal.sh
 */
export const LEGAL = {
  companyName: import.meta.env.VITE_COMPANY_NAME ?? "（公司名待补）",
  uscc: import.meta.env.VITE_USCC ?? "（统一社会信用代码待补）",
  icpFiling: import.meta.env.VITE_ICP_FILING ?? "（ICP 备案号待补）",
  policeFiling: import.meta.env.VITE_POLICE_FILING ?? "（公安备案号待补）",
  registeredAddress: import.meta.env.VITE_ADDRESS ?? "（注册地址待补）",
  supportPhone: import.meta.env.VITE_PHONE ?? "（客服电话待补）",
  legalRepresentative: import.meta.env.VITE_LEGAL_REP ?? "（法定代表人待补）",
};

/** 静态法务页（/var/www/legal、/var/www/landing）使用的同名占位，供填充脚本整体替换 */
export const LEGAL_PLACEHOLDERS = {
  companyName: "（公司名待补）",
  uscc: "（统一社会信用代码待补）",
  icpFiling: "（ICP 备案号待补）",
  policeFiling: "（公安备案号待补）",
  registeredAddress: "（注册地址待补）",
  supportPhone: "（客服电话待补）",
  legalRepresentative: "（法定代表人待补）",
} as const;

export const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL ?? "thalvior@foxmail.com";
