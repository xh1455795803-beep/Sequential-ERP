// 手机号归一化：仅支持中国大陆 +86，转为 E.164 格式
export function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (digits.startsWith("86") && digits.length === 13) {
    return `+${digits}`;
  }
  if (digits.length === 11) {
    return `+86${digits}`;
  }
  return input.trim();
}

// 判断输入是否为邮箱（含 @ 即视为邮箱）
export function isEmail(input: string): boolean {
  return input.includes("@");
}

// 判断输入是否为合法手机号（中国大陆 11 位，或已带 +86 前缀）
export function isPhone(input: string): boolean {
  if (input.includes("@")) return false;
  const digits = input.replace(/\D/g, "");
  return digits.length === 11 || (digits.startsWith("86") && digits.length === 13);
}