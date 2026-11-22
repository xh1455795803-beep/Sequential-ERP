// bill-import — 货代账单 CSV 导入 / 对账 / 差异 / 争议（卖家侧 Edge Function）
// =====================================================================
// 链路：货代发来账单 CSV → 导入批次(statement_import_batches) → 对账单(statements)
//       → 对账行(statement_lines) → 与系统费用行(billing_lines)/货件(shipments) 逐条匹配
//       → 差异标记(diff_flag) → 争议单(statement_disputes)
//
// 契约（POST + 调用者 Authorization；service_role 建连 + 代码层 checkPerm，与 forwarder-push 同一套）：
//   action="template"      → checkPerm("logistics.reconcile.view")   返回标准列定义 + 示例行 + 可直接下载的 csv_text
//   action="preview"       → checkPerm("logistics.reconcile.view")   解析+校验+试算，**不落库**
//   action="commit"        → checkPerm("logistics.billing.import")   写批次/对账单/对账行并匹配
//   action="list_batches"  → checkPerm("logistics.reconcile.view")   批次列表
//   action="batch_detail"  → checkPerm("logistics.reconcile.view")   批次内逐行明细（含匹配状态/差异/diff_flag）
//   action="match"         → checkPerm("logistics.billing.audit")    手工指定 shipments 后重新匹配并回写差异
//   action="dispute"       → checkPerm("logistics.billing.dispute")  开争议单 / 争议状态流转
//   action="export"        → checkPerm("logistics.reconcile.export") 把某批次差异行导出成 CSV 文本
//
// ---------------------------------------------------------------------
// 为什么权限必须显式走 checkPerm、租户隔离必须显式 .eq('user_id', userId)：
//   本项目所有 EF 都用 SUPABASE_SERVICE_ROLE_KEY 建 client，service_role 在库里 rolbypassrls=true，
//   RLS 对 EF 完全不生效。→ 权限只有 checkPerm 一条路，隔离只有代码层 where 一条路。
//
// ---------------------------------------------------------------------
// 口径（以生产库实测为准，2026-11-17 拉取）：
//   1) 金额/重量的 charged/declared 语义沿用 billing_lines 列注释：
//        weight_charged_g = 物流称重（克）——货代实测   ← 来自账单 CSV「计费重」
//        weight_declared_g = 自称重（克）——我方申报    ← 来自我方 shipments.declared_weight_g（**绝不用 CSV 值覆盖**）
//      因此账单侧映射为：charged_amount = CSV 金额（货代收我们的），declared_amount = billing_lines.amount（我方系统计费）。
//      diff = |charged − declared| / declared > 5%，与库内触发器 fn_billing_lines_diff_flag 同式。
//   2) diff_flag 由触发器 trg_billing_lines_diff_flag 基于**重量**自动维护（列注释「勿手工置位」），
//      本函数只写 weight_charged_g / weight_declared_g 让触发器去置位；**金额维度的差异库里没有列**，
//      由本函数即时计算后随响应返回（见交付报告缺口 G-3）。
//   3) 合计一律以库为准：写完对账行后调 statement_recalc(p_statement_id) 回写
//      statements.total_amount / line_count（该函数对 current_user='service_role' 放行）。
//      本函数不在 JS 里维护账单合计。
//   4) 不新建 billing_lines、不改 billing_lines.amount：匹配到的行只「挂进对账单 + 回填称重」，
//      避免与 rate_card 费用行重复计费（statement_lines 的 PK 与列注释「import 覆盖 auto」正是此意）。
//   5) shipments.actual_amount 由 billing_lines 汇总口径决定，本函数绝不增量累加、绝不写 shipments。
//   6) 单位固定：重量克(g)、长宽高厘米(cm)、金额 numeric(14,4)。重量入参若明显是 kg（<50 且列名含 kg）
//      只报 warning 不自动换算（避免把 800g 的小件错乘 1000）。
//   7) 幂等闸门：唯一键是 (user_id, batch_no) —— migration 2026-11-17d 把原先全局唯一的
//      statement_import_batches_batch_no_uk 换成了 statement_import_batches_user_batch_uk。
//      全局唯一会让第二个租户导入自己账期的账单时被前一个租户的同名批次号 409 顶死（缺口 G-1，已修）。
//        · batch_no 已存在且属于当前用户 → 返回 already_imported，零写入（不重复生成对账行）；
//        · 万一仍查到属于别人的行（旧库未迁移）→ 409 BATCH_NO_TAKEN_BY_OTHER_TENANT，悄悄改名重试是禁区。
//
// 错误返回统一 {code, message, details}（HTTP 4xx/5xx），message 中文可直接 toast。
// =====================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { checkPerm } from '../_shared/perm.ts';

const functionName = 'bill-import';

// =====================================================================
// >>>>>> PURE-CORE BEGIN >>>>>> 该区块无 import、无 IO，可被 node 单独抽取自测
// =====================================================================

// ---------- 定点小数：全程用 bigint + 固定 scale，杜绝浮点误差 ----------
const AMT_SCALE = 10000n;   // 金额 numeric(14,4)
const QTY_SCALE = 1000n;    // 数量 numeric(12,3)
const G_SCALE = 1000n;      // 重量 numeric(12,3)，单位克
const AMT_DP = 4;
const QTY_DP = 3;

const DIFF_THRESHOLD_BP = 500n;         // 5% —— 与库内触发器 0.05 同阈值
const BP_DENOM = 10000n;                // 万分比分母

interface Dec {
  ok: boolean;
  units: bigint;   // 已按 scale 放大后的整数
  text: string;    // 规范化十进制字符串（写库/出 JSON 用这个）
  err?: string;    // 解析失败原因码
}

const DEC_ZERO: Dec = { ok: true, units: 0n, text: '0' };

/** 定点转十进制字符串，去掉多余尾零（0.5000 → 0.5，与 numeric 语义一致） */
function fixed(units: bigint, scale: bigint, dp: number): string {
  const neg = units < 0n;
  let u = neg ? -units : units;
  const s = scale;
  const ip = u / s;
  const fp = u % s;
  let frac = fp.toString().padStart(dp, '0').replace(/0+$/, '');
  let out = ip.toString();
  if (frac) out += '.' + frac;
  if (out === '0' || out === '') out = '0';
  return (neg && out !== '0' ? '-' : '') + out;
}

/** half-up 舍入到 dp 位小数（字符串里的手工实现，不经过 Number） */
function roundFrac(frac: string, dp: number): { frac: string; carry: boolean } {
  if (frac.length <= dp) return { frac: frac.padEnd(dp, '0'), carry: false };
  const keep = frac.slice(0, dp);
  const nextDigit = frac.charCodeAt(dp) - 48;
  if (nextDigit >= 5) {
    // keep + 1，可能产生进位
    let digits = keep.split('');
    let i = digits.length - 1;
    let carry = true;
    while (i >= 0 && carry) {
      const d = (digits[i].charCodeAt(0) - 48) + 1;
      if (d >= 10) { digits[i] = '0'; i--; }
      else { digits[i] = String(d); carry = false; }
    }
    if (carry) return { frac: '0'.repeat(dp), carry: true };
    return { frac: digits.join(''), carry: false };
  }
  return { frac: keep, carry: false };
}

/**
 * 千分位 / 小数点歧义判定（在剥掉逗号之前跑）。
 * 本函数只承认一种口径：「, = 千分位、. = 小数点」（英美式，货代账单最常见）。
 * 出现欧式「1.234,56」或不成组的「1,50」一律判歧义并拒绝，交人工确认 —— 钱不能猜。
 */
function classifySepAmbiguity(v: string): string | null {
  const hasDot = v.includes('.');
  const hasCom = v.includes(',');
  if (!hasCom) {
    if (hasDot && (v.match(/\./g) || []).length > 1) return 'NUMBER_MULTI_DOT';
    return null;
  }
  if (hasDot && v.lastIndexOf(',') > v.lastIndexOf('.')) return 'NUMBER_FORMAT_AMBIGUOUS';   // 欧式：逗号才是小数点
  const parts = v.split(',');
  // 首组必须是 1~3 位数字：',123' / '1234,567' 都不成立，不能当成千分位放过
  if (!/^\d{1,3}$/.test(parts[0])) return 'NUMBER_FORMAT_AMBIGUOUS';
  const groups = parts.slice(1);
  const ok = groups.every((g) => /^\d{3}$/.test(g) || /^\d{3}\.\d+$/.test(g));
  return ok ? null : 'NUMBER_FORMAT_AMBIGUOUS';
}

/**
 * 解析一个「看起来是钱/重量」的字段。
 * 容忍：千分位（1,234,567.89）、不间断空格、货币符号（¥￥$€£ 与 CNY/USD 前缀）、后缀「元」、正负号、括号负数 (123.45)。
 * 拒绝：空串、纯符号、欧式/不成组的逗号（NUMBER_FORMAT_AMBIGUOUS）、多小数点、非数字、重量等不允许负的字段出现负号。
 * 超过 dp 位小数按 half-up 舍入（写库口径 numeric(14,4) / numeric(12,3)）。
 */
function parseDecimal(raw: string | null | undefined, scale: bigint, dp: number, allowNegative: boolean): Dec {
  let v = (raw ?? '').toString();
  if (!v) return { ok: false, units: 0n, text: '', err: 'EMPTY' };
  v = v.trim();
  if (!v) return { ok: false, units: 0n, text: '', err: 'EMPTY' };
  // 括号负数：(1,234.00) → -1234.00
  let parenNeg = false;
  if (/^\(.*\)$/.test(v)) { parenNeg = true; v = v.slice(1, -1).trim(); }
  // 先去掉空白 / 不间断空格 / 货币符号 / 中文单位，但**保留逗号**留给歧义判定
  v = v.replace(/[\s\u00A0\u3000]/g, '');
  v = v.replace(/^(CNY|USD|EUR|GBP|RMB|JPY|HKD)/i, '');
  v = v.replace(/[¥￥$€£₹]|元|円/g, '');
  if (!v) return { ok: false, units: 0n, text: '', err: 'EMPTY_AFTER_STRIP' };
  let neg = parenNeg;
  if (v.startsWith('+')) v = v.slice(1);
  else if (v.startsWith('-')) { neg = true; v = v.slice(1); }
  const ambiguous = classifySepAmbiguity(v);
  if (ambiguous) return { ok: false, units: 0n, text: '', err: ambiguous };
  v = v.replace(/,/g, '');
  if (!v) return { ok: false, units: 0n, text: '', err: 'EMPTY_AFTER_STRIP' };
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(v)) return { ok: false, units: 0n, text: '', err: 'NOT_A_NUMBER' };
  if (neg && !allowNegative) return { ok: false, units: 0n, text: '', err: 'NEGATIVE_NOT_ALLOWED' };
  const dot = v.indexOf('.');
  let intPart = dot === -1 ? v : v.slice(0, dot);
  const rawFrac = dot === -1 ? '' : v.slice(dot + 1);
  if (intPart === '') intPart = '0';
  const r = roundFrac(rawFrac, dp);          // r.frac 恒为 dp 位
  if (r.carry) intPart = addOneStr(intPart);
  // 约定 scale === 10^dp（AMT 1e4/4dp、QTY 与重量 1e3/3dp），故 frac 的每个单位就是 1 个最小单位
  const total = BigInt(intPart) * scale + (r.frac === '' ? 0n : BigInt(r.frac)) * (scale / 10n ** BigInt(dp));
  const signed = neg ? -total : total;
  return { ok: true, units: signed, text: fixed(signed, scale, dp) };
}

function addOneStr(intPart: string): string {
  let digits = intPart.split('');
  let i = digits.length - 1;
  let carry = true;
  while (i >= 0 && carry) {
    const d = (digits[i].charCodeAt(0) - 48) + 1;
    if (d >= 10) { digits[i] = '0'; i--; }
    else { digits[i] = String(d); carry = false; }
  }
  if (carry) digits.unshift('1');
  return digits.join('').replace(/^0+(?=\d)/, '');
}

const amt = (raw: string | null | undefined, allowNegative = true): Dec => parseDecimal(raw, AMT_SCALE, AMT_DP, allowNegative);
const qty = (raw: string | null | undefined): Dec => parseDecimal(raw, QTY_SCALE, QTY_DP, false);
const grams = (raw: string | null | undefined): Dec => parseDecimal(raw, G_SCALE, QTY_DP, false);

const dText = (d: Dec | null | undefined): string | null => (d && d.ok ? d.text : null);

/** |charged − declared| / declared > 5%（declared 为 0 时退化为「charged 非 0 即差异」，与库内触发器同式） */
function isDiff(chargedUnits: bigint | null, declaredUnits: bigint | null): boolean {
  if (chargedUnits === null || declaredUnits === null) return false;
  const ad = declaredUnits < 0n ? -declaredUnits : declaredUnits;
  const diff = chargedUnits - declaredUnits;
  const aDiff = diff < 0n ? -diff : diff;
  if (ad === 0n) return chargedUnits !== 0n;
  return aDiff * BP_DENOM > ad * DIFF_THRESHOLD_BP;
}

/** 差异万分比（四舍五入到整数 bp），declared=0 时返回 null */
function diffBp(chargedUnits: bigint | null, declaredUnits: bigint | null): number | null {
  if (chargedUnits === null || declaredUnits === null) return null;
  if (declaredUnits === 0n) return null;
  const ad = declaredUnits < 0n ? -declaredUnits : declaredUnits;
  const aDiff = (() => { const d = chargedUnits - declaredUnits; return d < 0n ? -d : d; })();
  return Number((aDiff * BP_DENOM + ad / 2n) / ad);
}

function addDec(list: Array<Dec | null>): bigint {
  let s = 0n;
  for (const d of list) if (d && d.ok) s += d.units;
  return s;
}

// ---------- CSV 解析（手写状态机，零依赖） ----------
// 支持：UTF-8 BOM、双引号包裹、字段内 "" 转义、字段内逗号与换行、CRLF/LF/CR 混用、空行跳过、
//       分隔符自动识别（, ; \t |），行号按**物理行**计（1 起），便于指回原文件。
export interface CsvRecord {
  line: number;        // 该记录起始物理行号
  endLine: number;     // 该记录结束物理行号（字段内换行时 > line）
  cells: string[];
}
export interface CsvParseResult {
  delimiter: string;
  header: CsvRecord | null;
  records: CsvRecord[];   // 已去掉全空行
  blankLines: number;
  ragged: Array<{ line: number, cells: number }>;  // 列数与表头不一致的行（只统计，不丢弃）
  error?: string;
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** 在前若干行里按候选分隔符的出现次数投票 */
function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const cands = [',', ';', '\t', '|'];
  let best = ',';
  let bestScore = -1;
  for (const c of cands) {
    let n = 0;
    let inQ = false;
    for (let i = 0; i < firstLine.length; i++) {
      const ch = firstLine[i];
      if (ch === '"') inQ = !inQ;
      else if (ch === c && !inQ) n++;
    }
    if (n > bestScore) { bestScore = n; best = c; }
  }
  return best;
}

/**
 * 状态机：0=字段首 1=字段内 2=引号内 3=引号内遇到引号
 * 一次扫完整个文本，不逐行 split —— 因此字段内换行天然支持。
 */
export function parseCsv(input: string): CsvParseResult {
  const text = stripBom(input ?? '');
  if (!text.trim()) return { delimiter: ',', header: null, records: [], blankLines: 0, ragged: [], error: 'EMPTY_FILE' };
  const delim = detectDelimiter(text);
  const out: CsvRecord[] = [];
  let cur: string[] = [];
  let field = '';
  let line = 1;
  let recStartLine = 1;
  let state = 0;
  let sawAnyCell = false;

  const pushRecord = (endLine: number) => {
    // 全空记录（只有一个空字段）跳过并计入 blankLines
    if (!sawAnyCell) { out.push({ line: recStartLine, endLine, cells: [] }); return; }
    out.push({ line: recStartLine, endLine, cells: cur });
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (state === 0) {
      if (ch === '"') { state = 2; sawAnyCell = true; continue; }
      if (ch === delim) { cur.push(''); sawAnyCell = true; continue; }
      if (ch === '\n') {
        if (cur.length || field !== '') { cur.push(field); pushRecord(line); }
        else { out.push({ line: recStartLine, endLine: line, cells: [] }); }
        cur = []; field = ''; sawAnyCell = false; state = 0; line++; recStartLine = line; continue;
      }
      if (ch === '\r') {
        if (text[i + 1] === '\n') continue;                    // CRLF：CR 只是噪声，交给后面的 LF 收尾
        if (cur.length) { pushRecord(line); }                  // 纯 CR 换行（老 Mac）
        else { out.push({ line: recStartLine, endLine: line, cells: [] }); }
        cur = []; field = ''; sawAnyCell = false; state = 0; line++; recStartLine = line; continue;
      }
      field = ch; sawAnyCell = true; state = 1; continue;
    }
    if (state === 1) {
      if (ch === delim) { cur.push(field); field = ''; state = 0; continue; }
      if (ch === '\n') { cur.push(field); pushRecord(line); cur = []; field = ''; sawAnyCell = false; state = 0; line++; recStartLine = line; continue; }
      if (ch === '\r') {
        // 纯 CR 换行（老 Mac）也当换行；CRLF 由下一个 \n 兜住，这里不重复计数
        if (text[i + 1] === '\n') { continue; }
        cur.push(field); pushRecord(line); cur = []; field = ''; sawAnyCell = false; state = 0; line++; recStartLine = line; continue;
      }
      field += ch; continue;
    }
    if (state === 2) {
      if (ch === '"') { state = 3; continue; }
      if (ch === '\n') line++;
      field += ch; continue;
    }
    // state === 3
    if (ch === '"') { field += '"'; state = 2; continue; }
    if (ch === delim) { cur.push(field); field = ''; state = 0; continue; }
    if (ch === '\n') { cur.push(field); pushRecord(line); cur = []; field = ''; sawAnyCell = false; state = 0; line++; recStartLine = line; continue; }
    if (ch === '\r') { if (text[i + 1] === '\n') continue; cur.push(field); pushRecord(line); cur = []; field = ''; sawAnyCell = false; state = 0; line++; recStartLine = line; continue; }
    // 引号后紧跟非引号非分隔符（如 "abc"x）—— 宽松收下，不炸整份文件
    field += ch; state = 1; continue;
  }
  // 收尾（文件末无换行）
  if (sawAnyCell || cur.length || field !== '') { cur.push(field); pushRecord(line); }
  else if (field === '' && cur.length === 0 && text.endsWith('\n')) { /* 末行为空：不算记录 */ }

  const blank = out.filter((r) => r.cells.length === 0).length;
  const records = out.filter((r) => r.cells.length > 0);
  const header = records.length ? records[0] : null;
  const body = records.slice(1);
  const ragged: Array<{ line: number, cells: number }> = [];
  if (header) for (const r of body) if (r.cells.length !== header.cells.length) ragged.push({ line: r.line, cells: r.cells.length });
  return { delimiter: delim, header, records: body, blankLines: blank, ragged };
}

/** CSV 序列化：含逗号/引号/换行的字段加引号，"" 转义 */
export function toCsv(rows: string[][], delimiter = ','): string {
  // 防电子表格公式注入：导出的 CSV 一定会被人用 Excel/WPS 打开，
  // 而货代账单里的 remark / external_ref / 文件名都是对方可控文本。
  // 规则：以 = + @ 开头，或 - 后面不接数字（-2+3 这类）→ 前置单引号使其成为纯文本。
  // 负数金额（-12.5、-3'000）不动，否则财务拿到的是带撇号的字符串，SUM 直接算错。
  // 放行条件收成「整格都是数字」：只挡 = + @ - 开头的单元格，但 `-1+cmd|'/c calc'!A0` 这种
  // 以 -1 开头的公式必须照样中和 —— 原来的 `^-[0-9.]` 前缀判断会被它绕过。
  const NUMERIC_CELL = /^-?[\d.,\s\u00A0'’¥$€()]+$/;
  const neutralize = (v: string): string => {
    if (!v || !/^[=+@-]/.test(v)) return v;
    if (v[0] === '-' && NUMERIC_CELL.test(v)) return v;   // 负数、(12.00) 冲抵行不能加撇号，否则财务 SUM 断掉
    return "'" + v;
  };
  const esc = (s: string): string => {
    const v = neutralize(s ?? '');
    return /[",\r\n;|\t]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  };
  return rows.map((r) => r.map(esc).join(delimiter)).join('\r\n') + '\r\n';
}

// ---------- 表头别名映射（集中定义，新增列只改这里） ----------
export type ColKey =
  | 'match_key' | 'wms_order_no' | 'tracking_no' | 'platform_order_no' | 'order_id'
  | 'amount' | 'currency' | 'weight_charged_g' | 'weight_declared_g'
  | 'fee_type' | 'charge_type' | 'charge_unit' | 'charge_qty' | 'unit_price'
  | 'period' | 'external_ref' | 'remark';

export interface ColumnDef {
  key: ColKey;
  label: string;           // 标准列名（模板表头用这个）
  aliases: string[];       // 归一化后参与匹配的别名（normHeader 处理）
  required: boolean;
  kind: 'text' | 'money' | 'weight' | 'qty' | 'date' | 'enum';
  example: string;
  note?: string;
}

/** 表头归一化：去 BOM/空白/全角空格、去括号内容（"计费重(kg)"→"计费重"）、小写、下划线转连字符 */
export function normHeader(s: string): string {
  let v = stripBom((s ?? '').toString()).trim().toLowerCase();
  v = v.replace(/[\s\u00A0\u3000]/g, '');
  v = v.replace(/[（(].*?[)）]/g, '');
  v = v.replace(/[「」【】\[\]]/g, '');
  v = v.replace(/_/g, '-');
  v = v.replace(/[·．。]/g, '');
  return v;
}

/**
 * 标准列定义 + 别名表。
 * 顺序 = 别名匹配优先级（先具体后泛化）：weight 类必须在 amount 之前，因为「计费重量」含「重量」，
 * 「费用金额」含「金额」，靠 normHeader 精确命中 + 强词兜底两段式解决。
 */
export const COLUMNS: ColumnDef[] = [
  {
    key: 'tracking_no', label: '运单号', required: false, kind: 'text', example: 'SF1234567890123',
    aliases: ['运单号', '跟踪号', '跟踪单号', '运单编号', '货代单号', '国际运单号', '国际跟踪号', '转单号', 'lastmile跟踪号',
      'tracking-no', 'trackingnumber', 'tracking', 'waybill-no', 'waybillnumber', 'tno'],
  },
  {
    key: 'wms_order_no', label: '货件号', required: false, kind: 'text', example: 'WMS20261101001',
    aliases: ['货件号', '系统单号', 'wms单号', 'wms订单号', '仓库单号', '出货单号', 'wms-order-no', 'wmsorderno', 'wmsno', 'shipment-no'],
  },
  {
    key: 'platform_order_no', label: '平台单号', required: false, kind: 'text', example: 'AMZ-1122334455',
    aliases: ['平台单号', '平台订单号', '店铺订单号', '订单号', '订单编号', '交易单号', 'platform-order-no', 'platformorderno', 'order-no', 'orderno'],
  },
  {
    key: 'order_id', label: '内部ID', required: false, kind: 'text', example: '',
    aliases: ['内部id', '系统id', '货件id', 'order-id', 'orderid', 'shipment-id'],
  },
  {
    key: 'amount', label: '费用', required: true, kind: 'money', example: '128.50',
    aliases: ['费用', '金额', '应收金额', '账单金额', '计费金额', '费用金额', '合计金额', '小计', 'amount', 'fee', 'charge', 'cost', 'total'],
  },
  {
    key: 'currency', label: '币种', required: false, kind: 'text', example: 'CNY',
    aliases: ['币种', '货币', '结算币种', 'currency', 'ccy'],
  },
  {
    key: 'weight_charged_g', label: '计费重(g)', required: false, kind: 'weight', example: '1250',
    aliases: ['计费重', '计费重量', '重量', '实重', '称重', '实测重', '体积重', '收费重', '计费实重',
      'charged-weight', 'chargeable-weight', 'weight', 'gross-weight', 'actual-weight', 'weight-kg', 'weight-g'],
  },
  {
    key: 'weight_declared_g', label: '申报重(g)', required: false, kind: 'weight', example: '1200',
    aliases: ['申报重', '申报重量', '自称重', '预报重', 'declared-weight', 'declaredweight', 'predicted-weight'],
  },
  {
    key: 'fee_type', label: '费用类型', required: false, kind: 'enum', example: 'intl_freight',
    aliases: ['费用类型', '费用大类', 'fee-type', 'feetype', 'type'],
    note: '可选：handling/domestic_freight/intl_freight/packaging/storage/duty/volumetric_diff/surcharge/vas/return_fee/insurance/adjustment',
  },
  {
    key: 'charge_type', label: '计费项目', required: false, kind: 'text', example: '国际运费',
    aliases: ['计费项目', '费用名称', '项目名称', '收费项目', '费用项', 'charge-type', 'chargetype', 'item', 'item-name', 'description'],
  },
  {
    key: 'charge_unit', label: '计费单位', required: false, kind: 'enum', example: 'kg',
    aliases: ['计费单位', '单位', 'charge-unit', 'chargeunit', 'unit'],
    note: '可选：piece/order/kg/cbm/manhour/flat',
  },
  {
    key: 'charge_qty', label: '数量', required: false, kind: 'qty', example: '1',
    aliases: ['数量', '件数', '票数', '计费数量', 'charge-qty', 'qty', 'quantity'],
  },
  {
    key: 'unit_price', label: '单价', required: false, kind: 'money', example: '128.50',
    aliases: ['单价', '费率', 'unit-price', 'unitprice', 'price', 'rate'],
  },
  {
    key: 'period', label: '费用日期', required: false, kind: 'date', example: '2026-11-03',
    aliases: ['费用日期', '日期', '计费日期', '发货日期', '出货日期', '入账日期', 'period', 'date', 'bill-date', 'shipment-date'],
  },
  {
    key: 'external_ref', label: '货代明细号', required: false, kind: 'text', example: 'FB-2026-11-000001',
    aliases: ['货代明细号', '明细号', '账单明细号', '货代费用id', '费用id', '序号', 'external-ref', 'externalref', 'ref', 'ref-no', 'detail-no', 'id'],
  },
  {
    key: 'remark', label: '备注', required: false, kind: 'text', example: '',
    aliases: ['备注', '说明', '留言', 'remark', 'memo', 'note', 'comments'],
  },
];

const COL_BY_KEY: Record<string, ColumnDef> = {};
for (const c of COLUMNS) COL_BY_KEY[c.key] = c;

/** 兜底强词：normHeader 精确别名没命中时，按「长度降序」做包含匹配，避免「计费重量」被判成金额 */
const FALLBACK_TOKENS: Array<[string, ColKey]> = (() => {
  const pairs: Array<[string, ColKey]> = [];
  for (const c of COLUMNS) for (const a of c.aliases) if (a.length >= 2) pairs.push([a, c.key]);
  pairs.sort((x, y) => y[0].length - x[0].length);
  return pairs;
})();

export interface ColumnPlan {
  /** 表头下标 -> 标准列 key；同一列重复命中时保留第一个（先到先得） */
  indexByKey: Partial<Record<ColKey, number>>;
  /** 未能识别的表头原文（下标 -> 文本） */
  unknown: Array<{ index: number, header: string }>;
  /** 命中多列的标准字段（后者被忽略），给前端提示用 */
  duplicated: Array<{ key: ColKey, index: number, header: string }>;
}

export function planColumns(headerCells: string[]): ColumnPlan {
  const indexByKey: Partial<Record<ColKey, number>> = {};
  const unknown: Array<{ index: number, header: string }> = [];
  const duplicated: Array<{ key: ColKey, index: number, header: string }> = [];
  const seen = new Set<string>();   // 已分配的标准列 key
  headerCells.forEach((h, i) => {
    const n = normHeader(h);
    if (!n) return;                 // 空表头列直接忽略
    let hit: ColKey | null = null;
    for (const c of COLUMNS) {
      if (c.aliases.some((a) => normHeader(a) === n)) { hit = c.key; break; }
    }
    if (!hit) {
      for (const [tok, key] of FALLBACK_TOKENS) {
        if (n.includes(tok)) { hit = key; break; }
      }
    }
    if (!hit) { unknown.push({ index: i, header: String(h).trim() }); return; }
    if (seen.has(hit)) { duplicated.push({ key: hit, index: i, header: String(h).trim() }); return; }
    seen.add(hit);
    indexByKey[hit] = i;
  });
  return { indexByKey, unknown, duplicated };
}

/** 日期归一：支持 2026-11-03 / 2026/11/3 / 2026.11.03 / 20261103 / 11-03（补当前年），失败返回 null */
export function normDate(s: string | null | undefined, fallbackYear: number): string | null {
  const v = (s ?? '').toString().trim();
  if (!v) return null;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(v);
  if (m) return iso(m[1], m[2], m[3]);
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (m) return iso(m[1], m[2], m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(v);      // 30/11/2026（日/月/年）
  if (m) return iso(m[3], m[2], m[1]);
  m = /^(\d{1,2})[-/.](\d{1,2})$/.exec(v);                   // 11-03 → 补年份
  if (m) return iso(String(fallbackYear), m[1], m[2]);
  return null;

  function iso(y: string, mo: string, d: string): string | null {
    const Y = Number(y), M = Number(mo), D = Number(d);
    if (!Number.isFinite(Y) || !Number.isFinite(M) || !Number.isFinite(D)) return null;
    if (M < 1 || M > 12 || D < 1 || D > 31) return null;
    return `${String(Y).padStart(4, '0')}-${String(M).padStart(2, '0')}-${String(D).padStart(2, '0')}`;
  }
}

const FEE_TYPES = new Set(['handling', 'domestic_freight', 'intl_freight', 'packaging', 'storage',
  'duty', 'volumetric_diff', 'surcharge', 'vas', 'return_fee', 'insurance', 'adjustment']);
const CHARGE_UNITS = new Set(['piece', 'order', 'kg', 'cbm', 'manhour', 'flat']);
const MATCH_KEYS: ColKey[] = ['wms_order_no', 'tracking_no', 'platform_order_no', 'order_id'];

export interface RowError { code: string; field?: string; message: string }

/** 归一后的一行账单（金额/重量为定点字符串，未落库前只做展示与试算） */
export interface NormRow {
  row_no: number;            // 物理行号（1 起，指回原 CSV）
  seq: number;               // 数据行序号（1 起，跳过空行）
  values: Partial<Record<ColKey, string>>;
  amount: Dec | null;
  unit_price: Dec | null;
  charge_qty: Dec | null;
  weight_charged_g: Dec | null;
  weight_declared_g: Dec | null;
  period: string | null;
  match_candidates: Array<{ key: ColKey; value: string }>;
  errors: RowError[];
  warnings: RowError[];
}

/**
 * 一行 CSV → 归一化对账行。不做匹配、不查库，纯函数。
 * 错误码全部稳定，前端按 code 出 i18n，message 是给人看的中文原文。
 */
export function normalizeRecord(cells: string[], plan: ColumnPlan, rowNo: number, seq: number, today: Date): NormRow {
  const take = (k: ColKey): string => {
    const i = plan.indexByKey[k];
    if (i === undefined) return '';
    const v = cells[i];
    return v == null ? '' : String(v).trim();
  };
  const values: Partial<Record<ColKey, string>> = {};
  for (const c of COLUMNS) { const v = take(c.key); if (v !== '') values[c.key] = v; }

  const errors: RowError[] = [];
  const warnings: RowError[] = [];

  const amount = take('amount') === ''
    ? null
    : amt(take('amount'), true);
  if (take('amount') === '') errors.push({ code: 'AMOUNT_MISSING', field: 'amount', message: '金额为空' });
  else if (amount && !amount.ok) errors.push({ code: 'AMOUNT_INVALID', field: 'amount', message: `金额无法解析（${amount.err}）：${take('amount')}` });

  const unit_price = take('unit_price') === '' ? null : amt(take('unit_price'), true);
  if (unit_price && !unit_price.ok) warnings.push({ code: 'UNIT_PRICE_INVALID', field: 'unit_price', message: `单价无法解析（${unit_price.err}）` });

  const charge_qty = take('charge_qty') === '' ? null : qty(take('charge_qty'));
  if (charge_qty && !charge_qty.ok) warnings.push({ code: 'QTY_INVALID', field: 'charge_qty', message: `数量无法解析（${charge_qty.err}）` });

  const weight_charged_g = take('weight_charged_g') === '' ? null : grams(take('weight_charged_g'));
  if (weight_charged_g && !weight_charged_g.ok) warnings.push({ code: 'WEIGHT_INVALID', field: 'weight_charged_g', message: `计费重无法解析（${weight_charged_g.err}）` });
  if (weight_charged_g && weight_charged_g.ok && weight_charged_g.units > 0n && weight_charged_g.units < 50_000n) {
    const h = normHeader(cells[plan.indexByKey['weight_charged_g'] ?? -1] ?? '');
    const kgHeader = /kg|千克|公斤/.test(h);
    warnings.push({
      code: 'WEIGHT_UNIT_SUSPECT_KG',
      field: 'weight_charged_g',
      message: kgHeader
        ? '表头带 kg 且数值偏小，本函数一律按「克」入库、不做自动换算，请确认单位'
        : '计费重不足 50 克，疑似把 kg 数值填进了克列；本函数一律按「克」入库、不做自动换算，请确认单位',
    });
  }

  const weight_declared_g = take('weight_declared_g') === '' ? null : grams(take('weight_declared_g'));
  if (weight_declared_g && !weight_declared_g.ok) warnings.push({ code: 'DECLARED_WEIGHT_INVALID', field: 'weight_declared_g', message: `申报重无法解析（${weight_declared_g.err}）` });

  let period: string | null = null;
  if (take('period') !== '') {
    period = normDate(take('period'), today.getUTCFullYear());
    if (!period) warnings.push({ code: 'PERIOD_INVALID', field: 'period', message: `费用日期无法解析：${take('period')}` });
  }

  const feeTypeRaw = take('fee_type');
  if (feeTypeRaw !== '' && !FEE_TYPES.has(feeTypeRaw.toLowerCase())) {
    warnings.push({ code: 'FEE_TYPE_UNKNOWN', field: 'fee_type', message: `费用类型不在字典内（${feeTypeRaw}），匹配时按计费项目文本兜底` });
  }
  const unitRaw = take('charge_unit');
  if (unitRaw !== '' && !CHARGE_UNITS.has(unitRaw.toLowerCase())) {
    warnings.push({ code: 'CHARGE_UNIT_UNKNOWN', field: 'charge_unit', message: `计费单位不在字典内（${unitRaw}）` });
  }

  const match_candidates: Array<{ key: ColKey; value: string }> = [];
  for (const k of MATCH_KEYS) { const v = take(k); if (v !== '') match_candidates.push({ key: k, value: v }); }
  if (match_candidates.length === 0) errors.push({ code: 'NO_MATCH_KEY', message: '缺少匹配键（运单号/货件号/平台单号/内部ID 至少填一个）' });

  const currency = take('currency');
  if (currency !== '' && !/^[A-Za-z]{3}$/.test(currency)) {
    warnings.push({ code: 'CURRENCY_INVALID', field: 'currency', message: `币种应为 3 位字母码（${currency}）` });
  }

  return { row_no: rowNo, seq, values, amount, unit_price, charge_qty, weight_charged_g, weight_declared_g, period, match_candidates, errors, warnings };
}

/** 匹配键优先级：wms_order_no → tracking_no → platform_order_no → order_id（按此顺序返回候选） */
export const MATCH_PRIORITY: ColKey[] = ['wms_order_no', 'tracking_no', 'platform_order_no', 'order_id'];

export function pickMatchKey(cands: Array<{ key: ColKey; value: string }>): { key: ColKey; value: string } | null {
  for (const k of MATCH_PRIORITY) { const c = cands.find((x) => x.key === k); if (c) return c; }
  return null;
}

/** 试算汇总：纯函数，输入归一行 + 匹配结果 */
export interface PreviewLine {
  row_no: number;
  seq: number;
  match_status: 'matched' | 'ambiguous' | 'unmatched' | 'error';
  matched_by?: string;
  match_value?: string;
  shipment_id?: string;
  shipment_tracking_no?: string;
  shipment_wms_order_no?: string;
  billing_line_id?: string;
  line_status?: string;
  fee_type?: string;
  charge_type?: string;
  currency: string;
  charged_amount: string | null;      // 货代账单金额
  declared_amount: string | null;     // 我方 billing_lines.amount
  amount_diff: string | null;         // charged − declared
  amount_diff_pct: number | null;     // 万分比
  amount_diff_flag: boolean;          // 金额维度 >5%（库里无列，仅返回）
  weight_charged_g: string | null;    // 货代计费重
  weight_declared_g: string | null;   // 我方申报重（不会被 CSV 覆盖）
  diff_flag: boolean;                 // 与库内触发器同式同阈值
  errors: RowError[];
  warnings: RowError[];
  candidates?: Array<{ billing_line_id: string; fee_type: string; charge_type: string; amount: string; status: string }>;
  voided?: boolean;   // 命中货件 doc_status=cancelled → 本行拒绝入账（铁律 2，与 forwarder-webhook 同规则）
}

export interface Summary {
  total_records: number;
  importable_rows: number;
  error_rows: number;
  unmatched_rows: number;
  ambiguous_rows: number;
  duplicate_rows: number;
  diff_amount_rows: number;
  diff_weight_rows: number;
  matched_rows: number;
  match_rate_pct: number;
  charged_amount_total: string;
  declared_amount_total: string;
  diff_amount_total: string;
  unmatched_amount_total: string;
}

// ---------- 以下自「库表/匹配」区上移：纯计算、无 import、无 IO（node 自测直接调 toPreviewLine）----------

const sstr = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

// =====================================================================
// 库表行类型（列名与 information_schema 实测一致）
// =====================================================================
interface ShipmentRow {
  id: string; user_id: string; tracking_no: string | null; wms_order_no: string | null;
  platform_order_no: string | null; order_id: string | null; carrier: string | null;
  declared_weight_g: number | string | null; charged_weight_g: number | string | null;
  actual_amount: number | string | null; fee_currency: string | null; forwarder_id: string | null;
  stage: string; doc_status: string; warehouse_id: string | null; intercept_state: string | null;
}
interface BillingRow {
  id: string; user_id: string; shipment_id: string | null; fee_type: string; charge_type: string | null;
  charge_unit: string | null; charge_qty: number | string | null; unit_price: number | string | null;
  amount: number | string; currency: string; weight_charged_g: number | string | null;
  weight_declared_g: number | string | null; diff_flag: boolean; source: string;
  external_ref: string | null; period: string | null; statement_id: string | null; status: string;
}

/** 有效费用行口径：排除 voided / rejected（与 shipments.actual_amount 汇总口径一致） */
const isEffective = (status: string): boolean => status !== 'voided' && status !== 'rejected';

// =====================================================================
// 匹配索引表结构（构建见下方 loadMatchIndex —— 本区块内唯一 IO 在那一处）
// =====================================================================
interface MatchIndex {
  byWms: Map<string, ShipmentRow[]>;
  byTracking: Map<string, ShipmentRow[]>;
  byPlatform: Map<string, ShipmentRow[]>;
  byOrderId: Map<string, ShipmentRow[]>;
  linesByShipment: Map<string, BillingRow[]>;
  lineById: Map<string, BillingRow>;
}

function keyOf(v: unknown): string { return sstr(v).trim(); }

function findShipments(idx: MatchIndex, key: ColKey, value: string): ShipmentRow[] {
  const v = keyOf(value);
  if (!v) return [];
  if (key === 'wms_order_no') return idx.byWms.get(v) ?? [];
  if (key === 'tracking_no') return idx.byTracking.get(v) ?? [];
  if (key === 'platform_order_no') return idx.byPlatform.get(v) ?? [];
  return idx.byOrderId.get(v) ?? [];
}

/** 该货件下属于本货代的费用行（账单是某个货代的，跨货代的货件不参与） */
function scopedLines(lines: BillingRow[], forwarderId: string | null, ships: Map<string, ShipmentRow>): BillingRow[] {
  if (!forwarderId) return lines;
  return lines.filter((l) => {
    const sid = sstr(l.shipment_id);
    if (!sid) return true;
    const sh = ships.get(sid);
    if (!sh) return true;
    return sstr(sh.forwarder_id) === forwarderId;
  });
}

// =====================================================================
// 归一一行 → 对账预览行（匹配 + 差异，纯计算，不落库）
// =====================================================================
export function toPreviewLine(
  r: NormRow,
  idx: MatchIndex | null,
  forwarderId: string | null,
  shipsById: Map<string, ShipmentRow>,
): PreviewLine {
  const cur = (r.values.currency || 'CNY').toUpperCase();
  const charged = r.amount && r.amount.ok ? r.amount.text : null;
  const base: PreviewLine = {
    row_no: r.row_no, seq: r.seq,
    match_status: r.errors.length ? 'error' : 'unmatched',
    currency: cur,
    charged_amount: charged,
    declared_amount: null,
    amount_diff: null,
    amount_diff_pct: null,
    amount_diff_flag: false,
    weight_charged_g: dText(r.weight_charged_g),
    weight_declared_g: dText(r.weight_declared_g),
    diff_flag: false,
    errors: r.errors.slice(),
    warnings: r.warnings.slice(),
    fee_type: r.values.fee_type ?? '',
    charge_type: r.values.charge_type ?? '',
  };
  if (!idx) return base;

  const cand = pickMatchKey(r.match_candidates);
  if (!cand) return { ...base, match_status: r.errors.length ? 'error' : 'unmatched' };
  base.matched_by = cand.key;
  base.match_value = cand.value;

  const hits = findShipments(idx, cand.key, cand.value);
  if (hits.length === 0) return { ...base, match_status: r.errors.length ? 'error' : 'unmatched' };
  const ships = hits.filter((s) => sstr(s.doc_status) !== 'cancelled');
  if (ships.length === 0) {
    const dead = hits[0];
    return {
      ...base,
      match_status: 'error',
      voided: true,
      shipment_id: dead.id,
      shipment_tracking_no: sstr(dead.tracking_no),
      shipment_wms_order_no: sstr(dead.wms_order_no),
      errors: base.errors.concat([{
        code: 'SHIPMENT_VOIDED',
        message: `货件 ${dead.id.slice(0, 8)} 已作废（doc_status=cancelled，拦截状态：${sstr(dead.intercept_state) || '-'}），`
          + `账单里的这一行拒绝入账；确属作废前已发生的费用请走争议工单，不要重开单据`,
      }]),
    };
  }
  if (ships.length < hits.length) {
    base.warnings = base.warnings.concat([{ code: 'VOIDED_CANDIDATE_IGNORED', message: `${hits.length - ships.length} 个同单号货件已作废，已从匹配候选中剔除` }]);
  }
  if (ships.length > 1) {
    base.warnings = base.warnings.concat([{ code: 'SHIPMENT_AMBIGUOUS', message: `${cand.key}=${cand.value} 命中 ${ships.length} 个货件，请人工指定` }]);
  }
  const shipIds = new Set(ships.map((s) => s.id));
  let pool: BillingRow[] = [];
  for (const sid of shipIds) pool = pool.concat(idx.linesByShipment.get(sid) ?? []);
  pool = scopedLines(pool, forwarderId, shipsById);
  if (pool.length === 0) {
    return {
      ...base,
      match_status: r.errors.length ? 'error' : 'unmatched',
      shipment_id: ships[0]?.id,
      shipment_tracking_no: sstr(ships[0]?.tracking_no),
      shipment_wms_order_no: sstr(ships[0]?.wms_order_no),
      warnings: base.warnings.concat([{ code: 'NO_BILLING_LINE', message: `货件 ${ships[0] ? ships[0].id.slice(0, 8) : '?'} 名下没有可参与对账的费用行（已排除 voided/rejected）` }]),
    };
  }
  const pick = pickBillingLine(
    pool.map((l) => ({ id: l.id, fee_type: l.fee_type, charge_type: l.charge_type, amount: sstr(l.amount), status: l.status })),
    r.values.fee_type ?? '',
    r.values.charge_type ?? '',
  );
  base.candidates = pick.candidates.map((l) => ({
    billing_line_id: l.id, fee_type: l.fee_type, charge_type: l.charge_type ?? '', amount: l.amount, status: l.status,
  }));
  if (!pick.picked) return { ...base, match_status: 'ambiguous' };

  const bl = idx.lineById.get(pick.picked.id)!;
  const d = diffFields(
    r.amount && r.amount.ok ? r.amount.units : null,
    r.weight_charged_g && r.weight_charged_g.ok ? r.weight_charged_g.units : null,
    r.weight_declared_g && r.weight_declared_g.ok ? r.weight_declared_g.units : null,
    { amount: sstr(bl.amount), currency: bl.currency, weight_declared_g: bl.weight_declared_g == null ? null : sstr(bl.weight_declared_g) },
    ships[0] ? { declared_weight_g: ships[0].declared_weight_g == null ? null : sstr(ships[0].declared_weight_g) } : null,
    cur,
  );

  return {
    ...base,
    match_status: r.errors.length ? 'error' : 'matched',
    shipment_id: sstr(bl.shipment_id) || sstr(ships[0]?.id),
    shipment_tracking_no: sstr(ships[0]?.tracking_no),
    shipment_wms_order_no: sstr(ships[0]?.wms_order_no),
    billing_line_id: bl.id,
    line_status: bl.status,
    fee_type: bl.fee_type,
    charge_type: sstr(bl.charge_type) || sstr(r.values.charge_type),
    currency: d.currency || cur,
    declared_amount: d.declared_amount,
    amount_diff: d.amount_diff,
    amount_diff_pct: d.amount_diff_pct,
    amount_diff_flag: d.amount_diff_flag,
    weight_declared_g: d.weight_declared_g ?? base.weight_declared_g,
    diff_flag: d.diff_flag,
    candidates: undefined,
    warnings: base.warnings,
  };
}

/** 逐行差异 + 汇总。bigInt 全部在内部算完再转字符串，出参只有字符串/数字。 */
export function buildSummary(lines: PreviewLine[]): Summary {
  let importable = 0, errored = 0, unmatched = 0, ambiguous = 0, dup = 0, diffAmt = 0, diffWt = 0, matched = 0;
  let chargedTotal = 0n, declaredTotal = 0n, diffTotal = 0n, unmatchedTotal = 0n;
  for (const l of lines) {
    const hard = l.errors.filter((e) => e.code !== 'DUPLICATE_IN_BATCH');
    if (l.errors.some((e) => e.code === 'DUPLICATE_IN_BATCH')) dup++;
    if (hard.length) errored++;
    if (l.match_status === 'matched') {
      matched++;
      chargedTotal += strToUnits(l.charged_amount, AMT_SCALE);
      declaredTotal += strToUnits(l.declared_amount, AMT_SCALE);
      diffTotal += strToUnits(l.charged_amount, AMT_SCALE) - strToUnits(l.declared_amount, AMT_SCALE);
      if (l.amount_diff_flag) diffAmt++;
      if (l.diff_flag) diffWt++;
      importable++;
    } else if (l.match_status === 'unmatched') {
      unmatched++;
      unmatchedTotal += strToUnits(l.charged_amount, AMT_SCALE);
      if (l.errors.length === 0) importable++;   // 挂不上费用行但可入库留痕（进 unmatched 明细）
    } else if (l.match_status === 'ambiguous') {
      ambiguous++;
    }
  }
  const denom = lines.length || 1;
  return {
    total_records: lines.length,
    importable_rows: importable,
    error_rows: errored,
    unmatched_rows: unmatched,
    ambiguous_rows: ambiguous,
    duplicate_rows: dup,
    diff_amount_rows: diffAmt,
    diff_weight_rows: diffWt,
    matched_rows: matched,
    match_rate_pct: Number((BigInt(matched) * 10000n) / BigInt(denom)) / 100,
    charged_amount_total: fixed(chargedTotal, AMT_SCALE, AMT_DP),
    declared_amount_total: fixed(declaredTotal, AMT_SCALE, AMT_DP),
    diff_amount_total: fixed(diffTotal, AMT_SCALE, AMT_DP),
    unmatched_amount_total: fixed(unmatchedTotal, AMT_SCALE, AMT_DP),
  };
}

/** 十进制字符串 -> 定点整数（内部用，输入已由 fixed 产生，格式可控） */
export function strToUnits(s: string | null, scale: bigint): bigint {
  if (!s) return 0n;
  const neg = s.startsWith('-');
  const v = neg ? s.slice(1) : s;
  const dot = v.indexOf('.');
  const ip = dot === -1 ? v : v.slice(0, dot);
  const fp = (dot === -1 ? '' : v.slice(dot + 1)).padEnd(6, '0').slice(0, 6);
  const units = BigInt(ip || '0') * scale + (BigInt(fp) * scale) / 1_000_000n;
  return neg ? -units : units;
}

/** 挑费用行：同 fee_type 唯一命中 > 同 charge_type 文本唯一命中 > 仅一条 > 多条=歧义 */
export function pickBillingLine(
  lines: Array<{ id: string; fee_type: string; charge_type: string | null; amount: string; status: string }>,
  wantFeeType: string,
  wantChargeType: string,
): { picked: (typeof lines)[number] | null; candidates: typeof lines } {
  const pool = lines;
  if (pool.length === 0) return { picked: null, candidates: [] };
  if (pool.length === 1) return { picked: pool[0], candidates: pool };
  if (wantFeeType) {
    const f = pool.filter((l) => (l.fee_type || '').toLowerCase() === wantFeeType.toLowerCase());
    if (f.length === 1) return { picked: f[0], candidates: pool };
    if (f.length > 1) return { picked: null, candidates: f };
  }
  if (wantChargeType) {
    const c = pool.filter((l) => normHeader(l.charge_type || '') === normHeader(wantChargeType));
    if (c.length === 1) return { picked: c[0], candidates: pool };
    if (c.length > 1) return { picked: null, candidates: c };
  }
  return { picked: null, candidates: pool };
}

/**
 * 逐行差异计算（生产代码路径，纯函数，可被 node 自测直接调用）。
 * 语义固定：charged = 货代账单侧；declared = 我方系统侧（billing_lines / shipments）。
 * 与库内触发器 fn_billing_lines_diff_flag 同式同阈值（>5%），只是这里同时算金额维度。
 * 入参一律用 string / bigint，不接受 JS number，避免中途掉进浮点。
 */
export interface SysFeeLine {
  amount: string | null;
  currency?: string | null;
  weight_declared_g?: string | null;
  weight_charged_g?: string | null;
}
export interface SysShipmentLite { declared_weight_g?: string | null }
export interface DiffOut {
  currency: string;
  declared_amount: string | null;
  amount_diff: string | null;
  amount_diff_pct: number | null;      // 万分比（1234 = 12.34%）
  amount_diff_flag: boolean;
  weight_declared_g: string | null;
  diff_flag: boolean;                   // 称重维度，与库内触发器一致
}

export function diffFields(
  chargedAmountUnits: bigint | null,
  chargedWeightUnits: bigint | null,
  csvDeclaredWeightUnits: bigint | null,
  sys: SysFeeLine | null,
  ship: SysShipmentLite | null,
  fallbackCurrency: string,
): DiffOut {
  const txt = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
  const declaredRaw = sys ? txt(sys.amount) : null;
  const declaredUnits = declaredRaw === null ? null : strToUnits(declaredRaw, AMT_SCALE);
  const diffUnits = (chargedAmountUnits !== null && declaredUnits !== null) ? chargedAmountUnits - declaredUnits : null;

  // 我方申报重优先取费用行已有值，其次取货件申报重；两者都没有才退回 CSV 的申报重列（仅展示，不入库覆盖）
  const ownFromLine = sys ? txt(sys.weight_declared_g) : null;
  const ownFromShip = ship ? txt(ship.declared_weight_g) : null;
  const ownUnits = ownFromLine !== null ? strToUnits(ownFromLine, G_SCALE)
    : ownFromShip !== null ? strToUnits(ownFromShip, G_SCALE) : null;
  const declaredWeightOut = ownUnits !== null ? fixed(ownUnits, G_SCALE, QTY_DP)
    : csvDeclaredWeightUnits !== null ? fixed(csvDeclaredWeightUnits, G_SCALE, QTY_DP) : null;

  return {
    currency: (txt(sys?.currency) ?? fallbackCurrency ?? 'CNY').toUpperCase(),
    declared_amount: declaredRaw,
    amount_diff: diffUnits === null ? null : fixed(diffUnits, AMT_SCALE, AMT_DP),
    amount_diff_pct: diffBp(chargedAmountUnits, declaredUnits),
    amount_diff_flag: isDiff(chargedAmountUnits, declaredUnits),
    weight_declared_g: declaredWeightOut,
    diff_flag: isDiff(chargedWeightUnits, ownUnits),
  };
}

/** 同批次内重复行：同一 billing_line_id 被两行账单命中 → 后到的标 DUPLICATE_IN_BATCH，不重复入账 */
export function markDuplicates(lines: PreviewLine[]): void {
  const seen = new Set<string>();
  for (const l of lines) {
    if (l.match_status !== 'matched' || !l.billing_line_id) continue;
    const k = l.billing_line_id;
    if (seen.has(k)) {
      l.match_status = 'error';
      l.errors = l.errors.concat([{ code: 'DUPLICATE_IN_BATCH', message: `同一费用行 ${k.slice(0, 8)} 已被前面的账单行命中，本行不重复入账` }]);
    } else seen.add(k);
  }
}

/** 差异行导出：把逐行结果压成给货代回传的 CSV（固定表头，顺序稳定） */
export const EXPORT_HEADERS = [
  '行号', '运单号', '货件号', '平台单号', '费用类型', '计费项目', '货代明细号',
  '币种', '货代账单金额', '我方计费金额', '差额', '差异比例(%)', '差异类型', '货代计费重(g)', '我方申报重(g)', '备注',
];

export function buildDiffRowsForExport(lines: PreviewLine[]): string[][] {
  const rows: string[][] = [EXPORT_HEADERS.slice()];
  for (const l of lines) {
    const kinds: string[] = [];
    if (l.amount_diff_flag) kinds.push('金额差异>5%');
    if (l.diff_flag) kinds.push('称重差异>5%');
    if (l.match_status === 'unmatched') kinds.push('系统未匹配');
    if (l.match_status === 'ambiguous') kinds.push('多条候选待人工指定');
    if (l.errors.length) kinds.push('数据错误:' + l.errors.map((e) => e.code).join('/'));
    if (!kinds.length) continue;   // 只导差异行
    rows.push([
      String(l.row_no), l.match_value ?? '', l.shipment_wms_order_no ?? '', '', l.fee_type ?? '', l.charge_type ?? '', '',
      l.currency, l.charged_amount ?? '', l.declared_amount ?? '', l.amount_diff ?? '',
      l.amount_diff_pct === null ? '' : (l.amount_diff_pct / 100).toFixed(2),
      kinds.join(';'), l.weight_charged_g ?? '', l.weight_declared_g ?? '',
      l.errors.map((e) => e.message).concat(l.warnings.map((w) => w.message)).join(' | '),
    ]);
  }
  return rows;
}

/** 模板示例行（3 条，全部假数据，不含任何真实客户信息） */
export function buildTemplateRows(): string[][] {
  const headers = COLUMNS.map((c) => c.label);
  const rows = COLUMNS.map((c) => c.example);
  const rows2 = COLUMNS.map((c) => {
    switch (c.key) {
      case 'tracking_no': return 'YT9988776655443';
      case 'wms_order_no': return 'WMS20261101002';
      case 'platform_order_no': return 'EBAY-99887766';
      case 'order_id': return '';
      case 'amount': return '68.00';
      case 'weight_charged_g': return '640';
      case 'weight_declared_g': return '600';
      case 'fee_type': return 'domestic_freight';
      case 'charge_type': return '国内段运费';
      case 'charge_qty': return '2';
      case 'unit_price': return '34.00';
      case 'period': return '2026-11-04';
      case 'external_ref': return 'FB-2026-11-000002';
      case 'remark': return '示例第 2 行';
      default: return c.example;
    }
  });
  const rows3 = COLUMNS.map((c) => {
    switch (c.key) {
      case 'tracking_no': return 'DHL0000000000';
      case 'wms_order_no': return '';
      case 'platform_order_no': return 'ALI-55443322';
      case 'order_id': return '';
      case 'amount': return '19.90';
      case 'weight_charged_g': return '300';
      case 'weight_declared_g': return '';
      case 'fee_type': return 'surcharge';
      case 'charge_type': return '偏远附加费,含燃油';
      case 'charge_qty': return '1';
      case 'unit_price': return '19.90';
      case 'period': return '2026-11-05';
      case 'external_ref': return 'FB-2026-11-000003';
      case 'remark': return '示例：字段内含逗号';
      default: return c.example;
    }
  });
  return [headers, rows, rows2, rows3];
}

// <<<<<< PURE-CORE END <<<<<<

// =====================================================================
// 基础设施
// =====================================================================

const MAX_ROWS = 2000;            // 单次 commit 上限（1.7G 内存机器，保护 EF 与数据库）
const MAX_PREVIEW_ROWS = 5000;
const MAX_STORED_ROWS = 3000;     // 落进 error_detail.rows 的上限
const MAX_CSV_BYTES = 4 * 1024 * 1024;
const IN_CHUNK = 200;             // PostgREST .in() 分片，避免 URL 过长

interface ErrBody { code: string; message: string; details?: unknown }

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    },
  });
}

function errBody(code: string, message: string, details?: unknown): { status: number; body: ErrBody } {
  return { status: 400, body: { code, message, ...(details === undefined ? {} : { details }) } };
}

function getEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`缺少环境变量 ${name}`);
  return v;
}

function adminClient() {
  return createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'));
}
type Admin = ReturnType<typeof adminClient>;

// 调用者身份：用 service_role client 换 JWT → user id（与 forwarder-push.resolveUserId 一致）
async function resolveUserId(req: Request): Promise<string | null> {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  try {
    const { data } = await adminClient().auth.getUser(token);
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

const nowIso = (): string => new Date().toISOString();

/** 取 CSV 文本：优先 csv（明文），其次 csv_base64。返回 null 表示没给或过大。 */
function readCsvText(body: Record<string, unknown>): { text?: string; error?: string } {
  const raw = body.csv;
  if (typeof raw === 'string' && raw.trim() !== '') {
    if (raw.length > MAX_CSV_BYTES) return { error: `CSV 过大（${raw.length} 字符 > ${MAX_CSV_BYTES}）` };
    return { text: raw };
  }
  const b64 = body.csv_base64;
  if (typeof b64 === 'string' && b64.trim() !== '') {
    let bin: string;
    try { bin = atob(b64.replace(/^data:[^,]*,/, '').replace(/\s+/g, '')); }
    catch { return { error: 'csv_base64 不是合法的 base64' }; }
    if (bin.length > MAX_CSV_BYTES) return { error: `CSV 解码后过大（${bin.length} 字节 > ${MAX_CSV_BYTES}）` };
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    try { return { text: new TextDecoder('utf-8', { fatal: false }).decode(bytes) }; }
    catch { return { error: 'CSV 解码失败（需 UTF-8）' }; }
  }
  return { error: '缺少 csv 或 csv_base64 字段' };
}

/** 内容指纹：batch_no 缺省时的稳定幂等键（文件名 + 内容 sha256 前 16 位） */
async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

const SHIP_SELECT = 'id, user_id, tracking_no, wms_order_no, platform_order_no, order_id, carrier, declared_weight_g, charged_weight_g, actual_amount, fee_currency, forwarder_id, stage, doc_status, warehouse_id, intercept_state';
const BILL_SELECT = 'id, user_id, shipment_id, fee_type, charge_type, charge_unit, charge_qty, unit_price, amount, currency, weight_charged_g, weight_declared_g, diff_flag, source, external_ref, period, statement_id, status';

// =====================================================================
// 载入候选货件 + 费用行，建匹配索引（本函数是 PURE-CORE 之外唯一的匹配 IO，只读）
// =====================================================================
async function loadMatchIndex(admin: Admin, userId: string, rows: NormRow[]): Promise<MatchIndex> {
  const idx: MatchIndex = {
    byWms: new Map(), byTracking: new Map(), byPlatform: new Map(), byOrderId: new Map(),
    linesByShipment: new Map(), lineById: new Map(),
  };
  const wms = new Set<string>(), trk = new Set<string>(), plat = new Set<string>(), oid = new Set<string>();
  for (const r of rows) {
    for (const c of r.match_candidates) {
      const v = keyOf(c.value);
      if (!v) continue;
      if (c.key === 'wms_order_no') wms.add(v);
      else if (c.key === 'tracking_no') trk.add(v);
      else if (c.key === 'platform_order_no') plat.add(v);
      else oid.add(v);
    }
  }
  const ships = new Map<string, ShipmentRow>();
  const pushShip = (s: ShipmentRow) => {
    if (sstr(s.user_id) !== userId) return;                 // 双保险：service_role 绕过 RLS
    if (!ships.has(s.id)) ships.set(s.id, s);
  };
  const addIdx = (m: Map<string, ShipmentRow[]>, k: string, s: ShipmentRow) => {
    const a = m.get(k); if (a) { if (!a.some((x) => x.id === s.id)) a.push(s); } else m.set(k, [s]);
  };

  const fetchShips = async (col: string, vals: Set<string>) => {
    const list = Array.from(vals);
    for (const part of chunk(list, IN_CHUNK)) {
      if (!part.length) continue;
      const { data, error } = await admin.from('shipments')
        .select(SHIP_SELECT).eq('user_id', userId).in(col, part).limit(2000);
      if (error) throw new Error(`查询 shipments(${col}) 失败：${error.message}`);
      for (const s of (data ?? []) as unknown as ShipmentRow[]) pushShip(s);
    }
  };
  await fetchShips('wms_order_no', wms);
  await fetchShips('tracking_no', trk);
  await fetchShips('platform_order_no', plat);
  await fetchShips('order_id', oid);

  for (const s of ships.values()) {
    const k1 = keyOf(s.wms_order_no); if (k1) addIdx(idx.byWms, k1, s);
    const k2 = keyOf(s.tracking_no); if (k2) addIdx(idx.byTracking, k2, s);
    const k3 = keyOf(s.platform_order_no); if (k3) addIdx(idx.byPlatform, k3, s);
    const k4 = keyOf(s.order_id); if (k4) addIdx(idx.byOrderId, k4, s);
  }

  const shipIds = Array.from(ships.keys());
  for (const part of chunk(shipIds, IN_CHUNK)) {
    if (!part.length) continue;
    const { data, error } = await admin.from('billing_lines')
      .select(BILL_SELECT).eq('user_id', userId).in('shipment_id', part).limit(10000);
    if (error) throw new Error(`查询 billing_lines 失败：${error.message}`);
    for (const l of (data ?? []) as unknown as BillingRow[]) {
      if (sstr(l.user_id) !== userId) continue;
      if (!isEffective(l.status)) continue;                 // voided / rejected 不参与对账
      idx.lineById.set(l.id, l);
      const sid = sstr(l.shipment_id);
      const arr = idx.linesByShipment.get(sid);
      if (arr) arr.push(l); else idx.linesByShipment.set(sid, [l]);
    }
  }
  return idx;
}



function toCsvDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function toCsvDateTime(d: Date): string {
  return `${toCsvDate(d)} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}`;
}

// ---------- 解析入口：CSV 文本 → 计划 + 归一行 + 文件级错误 ----------
interface ParseOutcome {
  parsed?: CsvParseResult;
  plan?: ColumnPlan;
  norm?: NormRow[];
  fileErrors: RowError[];
  unknownHeaders: Array<{ index: number; header: string }>;
  duplicateHeaders: Array<{ key: string; index: number; header: string }>;
  ragged: Array<{ line: number; cells: number }>;
  delimiter: string;
}

function parseToRows(text: string, limit: number): ParseOutcome {
  const out: ParseOutcome = {
    fileErrors: [], unknownHeaders: [], duplicateHeaders: [], ragged: [], delimiter: ',',
  };
  const parsed = parseCsv(text);
  out.parsed = parsed;
  out.delimiter = parsed.delimiter;
  if (parsed.error) { out.fileErrors.push({ code: parsed.error, message: '文件为空或不含任何记录' }); return out; }
  if (!parsed.header || parsed.header.cells.length === 0) {
    out.fileErrors.push({ code: 'NO_HEADER', message: '缺少表头行（第一行必须是列名）' });
    return out;
  }
  const plan = planColumns(parsed.header.cells);
  out.plan = plan;
  out.unknownHeaders = plan.unknown;
  out.duplicateHeaders = plan.duplicated;
  out.ragged = parsed.ragged;
  if (plan.indexByKey['amount'] === undefined) {
    out.fileErrors.push({ code: 'REQUIRED_COLUMN_MISSING', field: 'amount', message: '表头里找不到「费用/金额/amount」列' });
    return out;
  }
  if (!MATCH_KEYS.some((k) => plan.indexByKey[k] !== undefined)) {
    out.fileErrors.push({ code: 'REQUIRED_COLUMN_MISSING', field: 'tracking_no', message: '表头里至少要有一个匹配键列（运单号/货件号/平台单号/内部ID）' });
    return out;
  }
  if (parsed.records.length > limit) {
    out.fileErrors.push({ code: 'TOO_MANY_ROWS', message: `数据行 ${parsed.records.length} 条，超过上限 ${limit}` });
    return out;
  }
  const today = new Date();
  const norm: NormRow[] = [];
  let seq = 0;
  for (const rec of parsed.records) {
    seq++;
    norm.push(normalizeRecord(rec.cells, plan, rec.line, seq, today));
  }
  out.norm = norm;
  return out;
}

/** 把逐行结果压成可落库的普通对象（bigint 已全部是字符串，JSON.stringify 不会炸） */
function lineForStorage(l: PreviewLine): Record<string, unknown> {
  return {
    row_no: l.row_no, seq: l.seq, match_status: l.match_status,
    matched_by: l.matched_by ?? null, match_value: l.match_value ?? null,
    shipment_id: l.shipment_id ?? null, shipment_tracking_no: l.shipment_tracking_no ?? null,
    shipment_wms_order_no: l.shipment_wms_order_no ?? null,
    billing_line_id: l.billing_line_id ?? null, line_status: l.line_status ?? null,
    fee_type: l.fee_type ?? '', charge_type: l.charge_type ?? '', currency: l.currency,
    charged_amount: l.charged_amount, declared_amount: l.declared_amount,
    amount_diff: l.amount_diff, amount_diff_pct: l.amount_diff_pct, amount_diff_flag: l.amount_diff_flag,
    weight_charged_g: l.weight_charged_g, weight_declared_g: l.weight_declared_g, diff_flag: l.diff_flag,
    errors: l.errors, warnings: l.warnings,
  };
}

// =====================================================================
// action = template
// =====================================================================
async function actTemplate(admin: Admin, userId: string, body: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  const forwarderId = sstr(body.forwarder_id) || null;
  let forwarder: { id: string; name: string; code: string } | null = null;
  if (forwarderId) {
    const { data, error } = await admin.from('freight_forwarders')
      .select('id, name, code').eq('user_id', userId).eq('id', forwarderId).maybeSingle();
    if (error) return errBody('FORWARDER_QUERY_FAILED', `查询货代失败：${error.message}`);
    if (!data) return errBody('FORWARDER_NOT_FOUND_OR_FORBIDDEN', '货代不存在或不属于当前账号');
    forwarder = { id: sstr(data.id), name: sstr(data.name), code: sstr(data.code) };
  }
  // 该货代历史费用行的币种，作为模板默认币种提示
  let currencyHint = 'CNY';
  if (forwarderId) {
    const { data } = await admin.from('billing_lines').select('currency')
      .eq('user_id', userId).eq('status', 'approved').limit(50);
    const c = (data ?? [])[0]?.currency;
    if (c) currencyHint = String(c);
  }
  const rows = buildTemplateRows();
  return {
    status: 200,
    body: {
      ok: true,
      forwarder_id: forwarder?.id ?? null,
      forwarder_name: forwarder?.name ?? null,
      default_currency: currencyHint,
      delimiter: ',',
      encoding: 'UTF-8',
      units: { weight: 'g', length: 'cm', amount_decimals: AMT_DP },
      diff_rule: { metric: '|charged − declared| / declared', threshold_pct: 5, note: '与库内触发器 fn_billing_lines_diff_flag 同式；金额维度差异由本接口计算返回，库内 diff_flag 只跟称重' },
      columns: COLUMNS.map((c) => ({
        key: c.key, label: c.label, required: c.required, kind: c.kind, example: c.example,
        aliases: c.aliases, ...(c.note ? { note: c.note } : {}),
      })),
      sample_rows: rows.slice(1),
      csv_text: toCsv(rows, ','),
      notes: [
        '第一行必须是表头；列顺序任意，列名按别名表自动识别。',
        '金额支持千分位与货币符号（如 ¥1,280.50 / (12.00) 表示负数），最多 4 位小数。',
        '重量单位固定为克(g)；不要把 kg 填进「计费重(g)」。',
        '「运单号 / 货件号 / 平台单号 / 内部ID」至少要有一个，否则该行无法与系统费用行匹配。',
        '未识别的列会被忽略、不影响导入；一行列数与表头不一致只提示不丢弃。',
      ],
    },
  };
}

// =====================================================================
// action = preview —— 解析 + 逐行校验 + 试算，不落库
// =====================================================================
async function actPreview(admin: Admin, userId: string, body: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  const rd = readCsvText(body);
  if (rd.error) return errBody('CSV_READ_FAILED', rd.error);
  const forwarderId = sstr(body.forwarder_id);
  if (!forwarderId) return errBody('FORWARDER_REQUIRED', '缺少 forwarder_id（对账单必须挂在具体货代下）');

  const fwdR = await admin.from('freight_forwarders').select('id, name').eq('user_id', userId).eq('id', forwarderId).maybeSingle();
  if (fwdR.error) return errBody('FORWARDER_QUERY_FAILED', `查询货代失败：${fwdR.error.message}`);
  if (!fwdR.data) return errBody('FORWARDER_NOT_FOUND_OR_FORBIDDEN', '货代不存在或不属于当前账号');

  const po = parseToRows(rd.text ?? '', MAX_PREVIEW_ROWS);
  if (po.fileErrors.length) {
    return { status: 400, body: { ok: false, code: po.fileErrors[0].code, message: po.fileErrors[0].message, details: { file_errors: po.fileErrors } } };
  }
  const norm = po.norm ?? [];
  let idx: MatchIndex | null = null;
  const shipsById = new Map<string, ShipmentRow>();
  try {
    idx = await loadMatchIndex(admin, userId, norm);
    for (const m of [idx.byWms, idx.byTracking, idx.byPlatform, idx.byOrderId]) {
      for (const arr of m.values()) for (const s of arr) shipsById.set(s.id, s);
    }
  } catch (e) {
    return errBody('MATCH_DATA_QUERY_FAILED', e instanceof Error ? e.message : String(e));
  }
  const lines = norm.map((r) => toPreviewLine(r, idx, forwarderId, shipsById));
  markDuplicates(lines);
  const summary = buildSummary(lines);
  const fileName = sstr(body.file_name) || 'bill.csv';
  const period = derivePeriod(body, lines, norm);
  if (period.error) return errBody('PERIOD_REQUIRED', period.error);
  const batchNo = sstr(body.batch_no) || `BI-${toCsvDate(new Date()).replace(/-/g, '')}-${(await sha256Hex(fileName + '\n' + (rd.text ?? ''))).slice(0, 12)}`;

  // 幂等预检：preview 也告诉前端「这个批次号已经导过了」，省一次无谓点击
  let dup: Awaited<ReturnType<typeof existingBatch>> = { kind: 'none', row: null };
  try { dup = await existingBatch(admin, batchNo, userId); }
  catch (e) { return errBody('BATCH_QUERY_FAILED', e instanceof Error ? e.message : String(e)); }
  if (dup.kind === 'other_tenant') return { status: 409, body: { ok: false, code: 'BATCH_NO_TAKEN_BY_OTHER_TENANT', message: '批次号已被其它账号占用（唯一键已按租户隔离，出现该错误说明库未执行 2026-11-17d，请联系管理员）', details: { batch_no: batchNo } } };

  return {
    status: 200,
    body: {
      ok: true,
      already_imported: dup.kind === 'same_user',
      existing_batch: dup.row,
      dry_run: true,
      batch_no: batchNo,
      file_name: fileName,
      delimiter: po.delimiter,
      forwarder_id: forwarderId,
      forwarder_name: sstr(fwdR.data.name),
      statement: { period_from: period.from, period_to: period.to, currency: period.currency, warehouse_id: sstr(body.warehouse_id) || null },
      summary,
      unknown_headers: po.unknownHeaders,
      duplicated_headers: po.duplicateHeaders,
      ragged_rows: po.ragged,
      blank_lines: po.parsed?.blankLines ?? 0,
      errors: lines.filter((l) => l.errors.length).map((l) => ({ row_no: l.row_no, errors: l.errors })),
      warnings: lines.filter((l) => l.warnings.length).map((l) => ({ row_no: l.row_no, warnings: l.warnings })),
      lines: lines.slice(0, 500),
      lines_truncated: lines.length > 500,
    },
  };
}

/** 账期：显式传入 > CSV 里 min/max(费用日期) > 本月 1 号 ~ 今天 */
function derivePeriod(body: Record<string, unknown>, lines: PreviewLine[], norm: NormRow[]): { from: string; to: string; currency: string; error?: string } {
  const cur = (sstr(body.currency) || (() => {
    const set = new Set<string>();
    for (const l of lines) if (l.currency) set.add(l.currency.toUpperCase());
    return set.size === 1 ? Array.from(set)[0] : 'CNY';
  })()).toUpperCase();
  let from = sstr(body.period_from);
  let to = sstr(body.period_to);
  if (!from || !to) {
    const ds = norm.map((r) => r.period).filter((x): x is string => !!x).sort();
    if (ds.length) { from = from || ds[0]; to = to || ds[ds.length - 1]; }
    else {
      const now = new Date();
      from = from || toCsvDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
      to = to || toCsvDate(now);
    }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return { from, to, currency: cur, error: `账期格式必须是 YYYY-MM-DD（收到 period_from=${from} period_to=${to}）` };
  }
  if (to < from) return { from, to, currency: cur, error: `period_to(${to}) 不能早于 period_from(${from})` };
  return { from, to, currency: cur };
}

async function existingBatch(admin: Admin, batchNo: string, userId: string): Promise<{ kind: 'none' | 'same_user' | 'other_tenant'; row: Record<string, unknown> | null }> {
  const { data, error } = await admin.from('statement_import_batches')
    .select('id, user_id, statement_id, batch_no, file_name, row_count, ok_count, fail_count, imported_by, imported_at')
    // 唯一键是 (user_id, batch_no)：这里必须先按租户收敛，否则同一批次号跨租户两行会让
    // maybeSingle() 报 PGRST116，整条导入链路失效。跨租户的行根本查不到 → 也不再泄露对方节奏。
    .eq('user_id', userId).eq('batch_no', batchNo).maybeSingle();
  if (error) throw new Error(`查询导入批次失败：${error.message}`);
  if (!data) return { kind: 'none', row: null };
  if (sstr(data.user_id) !== userId) return { kind: 'other_tenant', row: null };  // 不回传他人数据
  return { kind: 'same_user', row: data as unknown as Record<string, unknown> };
}

// =====================================================================
// action = commit —— 落库：批次 → 对账单 → 对账行 → 匹配回写 → 重算合计
// =====================================================================
async function actCommit(admin: Admin, userId: string, body: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  const rd = readCsvText(body);
  if (rd.error) return errBody('CSV_READ_FAILED', rd.error);
  const text = rd.text ?? '';
  const forwarderId = sstr(body.forwarder_id);
  if (!forwarderId) return errBody('FORWARDER_REQUIRED', '缺少 forwarder_id');
  const fileName = sstr(body.file_name) || 'bill.csv';
  const allowUnmatched = body.allow_unmatched !== false;   // 默认允许留 unmatched 而不是丢弃

  const fwdR = await admin.from('freight_forwarders').select('id, name').eq('user_id', userId).eq('id', forwarderId).maybeSingle();
  if (fwdR.error) return errBody('FORWARDER_QUERY_FAILED', `查询货代失败：${fwdR.error.message}`);
  if (!fwdR.data) return errBody('FORWARDER_NOT_FOUND_OR_FORBIDDEN', '货代不存在或不属于当前账号');

  const po = parseToRows(text, MAX_ROWS);
  if (po.fileErrors.length) {
    return { status: 400, body: { ok: false, code: po.fileErrors[0].code, message: po.fileErrors[0].message, details: { file_errors: po.fileErrors } } };
  }
  const norm = po.norm ?? [];
  let idx: MatchIndex;
  const shipsById = new Map<string, ShipmentRow>();
  try {
    idx = await loadMatchIndex(admin, userId, norm);
    for (const m of [idx.byWms, idx.byTracking, idx.byPlatform, idx.byOrderId]) {
      for (const arr of m.values()) for (const s of arr) shipsById.set(s.id, s);
    }
  } catch (e) {
    return errBody('MATCH_DATA_QUERY_FAILED', e instanceof Error ? e.message : String(e));
  }
  const lines = norm.map((r) => toPreviewLine(r, idx, forwarderId, shipsById));
  markDuplicates(lines);
  const summary = buildSummary(lines);
  const period = derivePeriod(body, lines, norm);
  if (period.error) return errBody('PERIOD_REQUIRED', period.error);

  const hardErrors = lines.filter((l) => l.errors.length);
  if (hardErrors.length && body.allow_errors !== true) {
    return {
      status: 422,
      body: {
        ok: false, code: 'ROWS_HAVE_ERRORS', message: `${hardErrors.length} 行存在硬错误，已拒绝落库；修正后重试，或传 allow_errors=true 只导入可导入的行`,
        details: { summary, error_rows: hardErrors.slice(0, 100).map((l) => ({ row_no: l.row_no, errors: l.errors })) },
      },
    };
  }
  if (!allowUnmatched && summary.unmatched_rows > 0) {
    return { status: 422, body: { ok: false, code: 'UNMATCHED_ROWS_PRESENT', message: `有 ${summary.unmatched_rows} 行匹配不到系统费用行；确认后可传 allow_unmatched=true 落库留痕`, details: { summary } } };
  }
  if (summary.matched_rows === 0 && summary.unmatched_rows === 0) {
    return errBody('NOTHING_TO_IMPORT', '没有任何可导入的行');
  }

  const batchNo = sstr(body.batch_no) || `BI-${toCsvDate(new Date()).replace(/-/g, '')}-${(await sha256Hex(fileName + '\n' + text)).slice(0, 12)}`;

  // ---- 幂等闸门：先抢批次号（唯一键 user_id + batch_no），抢到才继续 ----
  let dup: Awaited<ReturnType<typeof existingBatch>>;
  try { dup = await existingBatch(admin, batchNo, userId); }
  catch (e) { return errBody('BATCH_QUERY_FAILED', e instanceof Error ? e.message : String(e)); }
  if (dup.kind === 'other_tenant') {
    // 唯一键已按租户隔离，正常路径不会走到这里；留着当 fail-closed 兜底（查到了别人的行就绝不用、绝不落库）
    return { status: 409, body: { ok: false, code: 'BATCH_NO_TAKEN_BY_OTHER_TENANT', message: '批次号归属校验未通过，本次未写入任何数据；请换一个批次号或联系管理员', details: { batch_no: batchNo } } };
  }
  if (dup.kind === 'same_user') {
    const stored = await loadBatchPayload(admin, sstr((dup.row as Record<string, unknown>).id));
    return {
      status: 200,
      body: {
        ok: true, already_imported: true, batch_no: batchNo,
        batch_id: sstr((dup.row as Record<string, unknown>).id),
        statement_id: sstr((dup.row as Record<string, unknown>).statement_id) || null,
        message: '该批次号已导入过，本次未产生任何写入（幂等命中）',
        batch: dup.row, summary: stored?.summary ?? null,
      },
    };
  }

  const { data: batchIns, error: bErr } = await admin.from('statement_import_batches')
    .insert({
      user_id: userId, statement_id: null, batch_no: batchNo, file_name: fileName,
      row_count: summary.total_records, ok_count: 0, fail_count: summary.error_rows,
      error_detail: { stage: 'running', started_at: nowIso(), summary: null, rows: [] },
      imported_by: userId, imported_at: nowIso(),
    })
    .select('id, batch_no')
    .maybeSingle();
  if (bErr) {
    if (bErr.code === '23505') {
      // 并发下另一个请求刚插了同批次号 —— 视为幂等命中，绝不重试写入
      const again = await existingBatch(admin, batchNo, userId).catch(() => ({ kind: 'other_tenant' as const, row: null }));
      if (again.kind === 'same_user') {
        return { status: 200, body: { ok: true, already_imported: true, batch_no: batchNo, batch_id: sstr((again.row as Record<string, unknown>).id), message: '并发重复提交，已命中同一批次（未产生重复对账行）', batch: again.row } };
      }
      return { status: 409, body: { ok: false, code: 'BATCH_NO_TAKEN_BY_OTHER_TENANT', message: '批次号冲突', details: { batch_no: batchNo } } };
    }
    return errBody('BATCH_INSERT_FAILED', `创建导入批次失败：${bErr.message}`);
  }
  const batchId = sstr(batchIns?.id);

  // ---- 对账单：命中 (user_id, forwarder_id, period_from, period_to, currency) 唯一键则复用 ----
  const stQ = await admin.from('statements')
    .select('id, status, source, total_amount, line_count, currency').eq('user_id', userId)
    .eq('forwarder_id', forwarderId).eq('period_from', period.from).eq('period_to', period.to)
    .eq('currency', period.currency).maybeSingle();
  if (stQ.error) return await failBatch(admin, batchId, `查询对账单失败：${stQ.error.message}`, 'STATEMENT_QUERY_FAILED');
  let statementId = sstr(stQ.data?.id) || '';
  let statementReused = !!stQ.data;
  if (statementReused && sstr(stQ.data?.status) === 'closed') {
    return await failBatch(admin, batchId, `该账期对账单已关账（closed），不可再导入`, 'STATEMENT_CLOSED');
  }
  if (statementReused && sstr(stQ.data?.status) === 'voided') {
    return await failBatch(admin, batchId, '该账期对账单已作废（voided）', 'STATEMENT_VOIDED');
  }
  if (!statementId) {
    const { data: stIns, error: stErr } = await admin.from('statements')
      .insert({
        user_id: userId, forwarder_id: forwarderId,
        warehouse_id: sstr(body.warehouse_id) || null,
        period_from: period.from, period_to: period.to, currency: period.currency,
        status: 'draft', source: 'import', imported_at: nowIso(), imported_by: userId,
        file_ref: sstr(body.file_ref) || fileName, notes: sstr(body.notes) || null,
      }).select('id').maybeSingle();
    if (stErr) {
      if (stErr.code === '23505') return await failBatch(admin, batchId, '并发创建了对账单，请重试本次导入', 'STATEMENT_RACE');
      return await failBatch(admin, batchId, `创建对账单失败：${stErr.message}`, 'STATEMENT_INSERT_FAILED');
    }
    statementId = sstr(stIns?.id);
  } else {
    const patch: Record<string, unknown> = { source: 'import', imported_at: nowIso(), imported_by: userId, file_ref: sstr(body.file_ref) || fileName };
    if (sstr(stQ.data?.status) === 'draft' && sstr(body.notes)) patch.notes = sstr(body.notes);
    await admin.from('statements').update(patch).eq('id', statementId).eq('user_id', userId);
  }

  // ---- 逐行落库 ----
  let attached = 0, weightUpdated = 0, lockedSkipped = 0, attachFailed = 0, refUpdated = 0;
  const writeErrors: Array<{ row_no: number; code: string; message: string }> = [];
  for (const l of lines) {
    if (l.match_status !== 'matched' || !l.billing_line_id || !statementId) continue;
    const bl = idx.lineById.get(l.billing_line_id);
    if (!bl) continue;
    // ① 关联：PK (statement_id, billing_line_id) 天然去重；已有 auto 关联按「import 覆盖 auto」改写
    const { error: slErr } = await admin.from('statement_lines')
      .upsert({ statement_id: statementId, billing_line_id: l.billing_line_id, user_id: userId, source: 'import' },
        { onConflict: 'statement_id,billing_line_id' });
    if (slErr) { attachFailed++; writeErrors.push({ row_no: l.row_no, code: 'STATEMENT_LINE_UPSERT_FAILED', message: slErr.message }); continue; }
    attached++;

    // ② 回写：只动 statement_id / 称重 / 货代侧引用，绝不动 amount（防重复计费与改历史费用）
    const patch: Record<string, unknown> = { statement_id: statementId };
    if (!sstr(bl.external_ref) && sstr(l.match_value)) { patch.external_ref = sstr(l.match_value); refUpdated++; }
    const wCharged = strToUnits(l.weight_charged_g ?? '', G_SCALE);
    const curWCharged = bl.weight_charged_g === null || bl.weight_charged_g === undefined ? null : strToUnits(sstr(bl.weight_charged_g), G_SCALE);
    const curWDeclared = bl.weight_declared_g === null || bl.weight_declared_g === undefined ? null : strToUnits(sstr(bl.weight_declared_g), G_SCALE);
    const ship = sstr(bl.shipment_id) ? shipsById.get(sstr(bl.shipment_id)) : undefined;
    const declaredFromShip = ship && ship.declared_weight_g !== null && ship.declared_weight_g !== undefined
      ? strToUnits(sstr(ship.declared_weight_g), G_SCALE) : null;
    const nextDeclared = curWDeclared ?? declaredFromShip;      // 我方申报重不由 CSV 提供
    const wantCharged = wCharged > 0n ? wCharged : null;
    const changedW = (wantCharged !== null && wantCharged !== curWCharged) || (curWDeclared === null && nextDeclared !== null);
    if (changedW) {
      if (bl.status === 'approved') {
        // fn_billing_lines_approved_lock 会让这类 UPDATE 直接抛错，这里提前跳过并留痕
        lockedSkipped++;
        patch.diff_flag = isDiff(wantCharged ?? curWCharged, nextDeclared ?? curWDeclared);
        writeErrors.push({ row_no: l.row_no, code: 'LINE_LOCKED_APPROVED', message: `费用行 ${bl.id.slice(0, 8)} 已审核，称重不可改（需先打回再重审），本行只挂单不改称重` });
      } else {
        if (wantCharged !== null) patch.weight_charged_g = fixed(wantCharged, G_SCALE, QTY_DP);
        if (curWDeclared === null && nextDeclared !== null) patch.weight_declared_g = fixed(nextDeclared, G_SCALE, QTY_DP);
        weightUpdated++;
      }
    }
    const { error: upErr } = await admin.from('billing_lines').update(patch).eq('id', l.billing_line_id).eq('user_id', userId);
    if (upErr) { writeErrors.push({ row_no: l.row_no, code: 'BILLING_LINE_UPDATE_FAILED', message: upErr.message }); }
  }

  // ---- 作废单据的费用行：只拒绝入账还不够，必须冒泡成人看得见的工单（与 forwarder-webhook 同口径）----
  let voidedRows = 0;
  const voidedWo = new Map<string, PreviewLine[]>();
  for (const l of lines) {
    if (!l.voided || !l.shipment_id) continue;
    voidedRows++;
    const arr = voidedWo.get(l.shipment_id);
    if (arr) arr.push(l); else voidedWo.set(l.shipment_id, [l]);
  }
  let voidedWorkOrders = 0;
  for (const [sid, ls] of voidedWo) {
    const sh = shipsById.get(sid);
    if (!sh) continue;
    const items = ls.slice(0, 20).map((l) => `${l.fee_type || '?'}=${l.charged_amount || '?'}${l.currency}`).join(', ');
    const { error: woErr } = await admin.from('work_orders').insert({
      user_id: userId,
      forwarder_id: forwarderId,
      warehouse_id: sstr(sh.warehouse_id) || null,
      shipment_id: sh.id,
      order_id: sstr(sh.order_id) || null,
      type: 'other',
      stage_when_detected: sh.stage,
      title: `已作废单据出现在货代账单里：${ls.length} 行未入账`,
      description: `来源：账单导入（bill-import），批次 ${batchNo}，文件 ${fileName}。`
        + `该货件 doc_status=cancelled（拦截状态：${sstr(sh.intercept_state) || '-'}），`
        + `账单携带的费用已全部拒绝入账：${items}。`
        + `请人工判定：确属作废前已发生 → 手工补录费用行并说明依据；否则驳回货代。`,
      status: 'pending',
      priority: 'normal',
      assignee_type: 'forwarder',
      created_by: null,
    });
    if (woErr) writeErrors.push({ row_no: ls[0].row_no, code: 'VOIDED_WORK_ORDER_FAILED', message: woErr.message });
    else voidedWorkOrders++;
  }

  // ---- 合计以库为准 ----
  let recalc: { total_amount: string; line_count: number } | null = null;
  if (statementId) {
    const { data: rc, error: rcErr } = await admin.rpc('statement_recalc', { p_statement_id: statementId });
    if (rcErr) writeErrors.push({ row_no: 0, code: 'STATEMENT_RECALC_FAILED', message: rcErr.message });
    else {
      const row = Array.isArray(rc) ? rc[0] : rc;
      recalc = { total_amount: sstr((row as Record<string, unknown>)?.total_amount ?? '0'), line_count: Number((row as Record<string, unknown>)?.line_count ?? 0) };
    }
  }

  // ---- 批次收尾：payload 落进 error_detail（缺口 G-2：没有对账行原文表，未匹配行只能存在这里）----
  const storedRows = lines.slice(0, MAX_STORED_ROWS).map(lineForStorage);
  const payload = {
    stage: 'done',
    finished_at: nowIso(),
    delimiter: po.delimiter,
    header: (po.parsed?.header?.cells ?? []),
    unknown_headers: po.unknownHeaders,
    duplicated_headers: po.duplicateHeaders,
    ragged_rows: po.ragged,
    blank_lines: po.parsed?.blankLines ?? 0,
    period: { from: period.from, to: period.to, currency: period.currency },
    forwarder: { id: forwarderId, name: sstr(fwdR.data.name) },
    summary,
    write: {
      attached, weight_updated: weightUpdated, locked_skipped: lockedSkipped, attach_failed: attachFailed,
      external_ref_filled: refUpdated, rows_truncated: lines.length > MAX_STORED_ROWS,
      voided_rows: voidedRows, voided_work_orders: voidedWorkOrders,
    },
    recalc,
    errors: lines.filter((l) => l.errors.length).map((l) => ({ row_no: l.row_no, match_status: l.match_status, errors: l.errors })),
    warnings: lines.filter((l) => l.warnings.length).map((l) => ({ row_no: l.row_no, warnings: l.warnings })),
    unmatched: lines.filter((l) => l.match_status === 'unmatched').map(normRowLite),
    voided: lines.filter((l) => l.voided).map(normRowLite),
    rows: storedRows,
  };
  const { error: bUpErr } = await admin.from('statement_import_batches')
    .update({
      statement_id: statementId || null,
      row_count: summary.total_records,
      ok_count: summary.matched_rows + (allowUnmatched ? summary.unmatched_rows : 0),
      fail_count: summary.error_rows + (allowUnmatched ? 0 : summary.unmatched_rows),
      error_detail: payload,
    })
    .eq('id', batchId).eq('user_id', userId);
  if (bUpErr) writeErrors.push({ row_no: 0, code: 'BATCH_FINALIZE_FAILED', message: bUpErr.message });

  return {
    status: 200,
    body: {
      ok: true, already_imported: false,
      batch_id: batchId, batch_no: batchNo,
      statement_id: statementId || null, statement_reused: statementReused,
      forwarder_id: forwarderId, file_name: fileName,
      statement: { period_from: period.from, period_to: period.to, currency: period.currency, recalc },
      summary,
      write: payload.write,
      errors: lines.filter((l) => l.errors.length).map((l) => ({ row_no: l.row_no, errors: l.errors })),
      write_errors: writeErrors,
    },
  };
}

function normRowLite(l: PreviewLine): Record<string, unknown> {
  return {
    row_no: l.row_no, seq: l.seq, match_status: l.match_status,
    matched_by: l.matched_by ?? null, match_value: l.match_value ?? null,
    fee_type: l.fee_type ?? '', charge_type: l.charge_type ?? '', currency: l.currency,
    charged_amount: l.charged_amount, weight_charged_g: l.weight_charged_g,
    errors: l.errors, warnings: l.warnings,
  };
}

async function failBatch(admin: Admin, batchId: string, message: string, code: string): Promise<{ status: number; body: unknown }> {
  await admin.from('statement_import_batches')
    .update({ error_detail: { stage: 'failed', failed_at: nowIso(), code, message } })
    .eq('id', batchId);
  return { status: 422, body: { ok: false, code, message, details: { batch_id: batchId } } };
}

async function loadBatchPayload(admin: Admin, batchId: string): Promise<{ summary: Record<string, unknown> | null; payload: Record<string, unknown> | null } | null> {
  const { data, error } = await admin.from('statement_import_batches')
    .select('id, error_detail, statement_id, row_count, ok_count, fail_count').eq('id', batchId).maybeSingle();
  if (error || !data) return null;
  const p = (data.error_detail && typeof data.error_detail === 'object') ? data.error_detail as Record<string, unknown> : null;
  return { summary: (p?.summary as Record<string, unknown>) ?? null, payload: p };
}

// =====================================================================
// action = list_batches
// =====================================================================
async function actListBatches(admin: Admin, userId: string, body: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 200);
  const offset = Math.max(Number(body.offset) || 0, 0);
  const forwarderId = sstr(body.forwarder_id);
  const BATCH_SELECT = 'id, user_id, statement_id, batch_no, file_name, row_count, ok_count, fail_count, error_detail, imported_by, imported_at';

  const cnt = await admin.from('statement_import_batches')
    .select('id', { count: 'exact', head: true }).eq('user_id', userId);
  const { data, error } = await admin.from('statement_import_batches')
    .select(BATCH_SELECT).eq('user_id', userId)
    .order('imported_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) return errBody('BATCH_LIST_FAILED', `查询批次失败：${error.message}`);
  let rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  let total = cnt.count ?? rows.length;

  // 批次表没有 forwarder_id（缺口 G-4）：只能先取本页再按 statement 反查货代过滤，
  // 因此按货代过滤时 total 是本上限内的数量，不是全库数量 —— 响应里已如实标注。
  if (forwarderId) {
    const st = await admin.from('statements').select('id').eq('user_id', userId).eq('forwarder_id', forwarderId).limit(5000);
    if (st.error) return errBody('STATEMENT_QUERY_FAILED', `查询对账单失败：${st.error.message}`);
    const ids = new Set((st.data ?? []).map((s: Record<string, unknown>) => sstr(s.id)));
    rows = rows.filter((r) => ids.has(sstr(r.statement_id)));
    total = rows.length;
    return {
      status: 200,
      body: {
        ok: true, total, batches: rows.map(shapeBatch),
        total_note: `按 forwarder 过滤是在本页 ${limit} 条内过滤后的条数（statement_import_batches 无 forwarder_id 列）`,
      },
    };
  }
  return { status: 200, body: { ok: true, total, batches: rows.map(shapeBatch) } };
}

function shapeBatch(r: Record<string, unknown>): Record<string, unknown> {
  const p = (r.error_detail && typeof r.error_detail === 'object') ? r.error_detail as Record<string, unknown> : {};
  const s = (p.summary && typeof p.summary === 'object') ? p.summary as Record<string, unknown> : {};
  const fwd = (p.forwarder && typeof p.forwarder === 'object') ? p.forwarder as Record<string, unknown> : {};
  return {
    id: sstr(r.id), batch_no: sstr(r.batch_no), file_name: sstr(r.file_name),
    statement_id: sstr(r.statement_id) || null, imported_by: sstr(r.imported_by) || null,
    imported_at: sstr(r.imported_at) || null,
    row_count: r.row_count ?? null, ok_count: r.ok_count ?? null, fail_count: r.fail_count ?? null,
    stage: sstr(p.stage) || 'unknown',
    forwarder_id: sstr(fwd.id) || null, forwarder_name: sstr(fwd.name) || null,
    period_from: sstr((p.period as Record<string, unknown>)?.from) || null,
    period_to: sstr((p.period as Record<string, unknown>)?.to) || null,
    currency: sstr((p.period as Record<string, unknown>)?.currency) || null,
    summary: s,
    match_rate_pct: typeof s.match_rate_pct === 'number' ? s.match_rate_pct : null,
    unmatched_rows: typeof s.unmatched_rows === 'number' ? s.unmatched_rows : null,
    diff_amount_rows: typeof s.diff_amount_rows === 'number' ? s.diff_amount_rows : null,
    diff_amount_total: sstr(s.diff_amount_total) || null,
    charged_amount_total: sstr(s.charged_amount_total) || null,
    declared_amount_total: sstr(s.declared_amount_total) || null,
    error_count: Array.isArray(p.errors) ? (p.errors as unknown[]).length : 0,
  };
}

// =====================================================================
// action = batch_detail —— 批次内逐行明细（实时重算差异，不依赖存量）
// =====================================================================
async function actBatchDetail(admin: Admin, userId: string, body: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  const batchId = sstr(body.batch_id);
  const batchNo = sstr(body.batch_no);
  if (!batchId && !batchNo) return errBody('BATCH_ID_REQUIRED', '缺少 batch_id 或 batch_no');
  const DETAIL_SELECT = 'id, statement_id, batch_no, file_name, row_count, ok_count, fail_count, error_detail, imported_by, imported_at';
  const bQ = admin.from('statement_import_batches')
    .select(DETAIL_SELECT).eq('user_id', userId);
  const { data, error } = await (batchId ? bQ.eq('id', batchId) : bQ.eq('batch_no', batchNo)).maybeSingle();
  if (error) return errBody('BATCH_DETAIL_FAILED', `查询批次失败：${error.message}`);
  if (!data) return { status: 404, body: { ok: false, code: 'BATCH_NOT_FOUND', message: '批次不存在或不属于当前账号' } };
  const b = data as unknown as Record<string, unknown>;
  const payload = (b.error_detail && typeof b.error_detail === 'object') ? b.error_detail as Record<string, unknown> : {};
  const statementId = sstr(b.statement_id);

  // 当前真实库状态（导入后可能被审核/作废）
  let fresh = new Map<string, BillingRow>();
  if (statementId) {
    const { data: sl } = await admin.from('statement_lines').select('billing_line_id').eq('user_id', userId).eq('statement_id', statementId).limit(5000);
    const ids = (sl ?? []).map((x: Record<string, unknown>) => sstr(x.billing_line_id));
    for (const part of chunk(ids, IN_CHUNK)) {
      if (!part.length) continue;
      const { data: bl } = await admin.from('billing_lines').select(BILL_SELECT).eq('user_id', userId).in('id', part).limit(5000);
      for (const l of (bl ?? []) as unknown as BillingRow[]) fresh.set(l.id, l);
    }
  }
  const storedRows = Array.isArray(payload.rows) ? payload.rows as Array<Record<string, unknown>> : [];
  const lines: Array<Record<string, unknown>> = [];
  for (const r of storedRows) {
    const blId = sstr(r.billing_line_id);
    const f = blId ? fresh.get(blId) : undefined;
    // 用与 commit/preview 完全相同的纯函数重算，读接口不会再养出第二套差异口径。
    // 费用行已被删除/不在本页时退回导入时快照，保证历史差异仍可查看。
    const sys: SysFeeLine = f
      ? { amount: sstr(f.amount), currency: f.currency, weight_declared_g: f.weight_declared_g == null ? null : sstr(f.weight_declared_g) }
      : { amount: r.declared_amount == null ? null : sstr(r.declared_amount), currency: sstr(r.currency), weight_declared_g: r.weight_declared_g == null ? null : sstr(r.weight_declared_g) };
    const d = diffFields(
      r.charged_amount ? strToUnits(sstr(r.charged_amount), AMT_SCALE) : null,
      r.weight_charged_g ? strToUnits(sstr(r.weight_charged_g), G_SCALE) : null,
      r.weight_declared_g ? strToUnits(sstr(r.weight_declared_g), G_SCALE) : null,
      sys,
      null,
      sstr(r.currency) || 'CNY',
    );
    lines.push({
      ...r,
      declared_amount: d.declared_amount,
      amount_diff: d.amount_diff,
      amount_diff_pct: d.amount_diff_pct,
      amount_diff_flag: d.amount_diff_flag,
      weight_declared_g: d.weight_declared_g ?? (r.weight_declared_g ?? null),
      currency: d.currency,
      diff_flag_now: f ? !!f.diff_flag : d.diff_flag,   // 库内触发器实际置位值 vs 本函数算出的值
      line_status_now: f ? f.status : (r.line_status ?? null),
    });
  }
  const disputes = statementId
    ? (await admin.from('statement_disputes').select('id, billing_line_id, status, reason, claimed_amount').eq('user_id', userId).eq('statement_id', statementId).limit(2000)).data ?? []
    : [];
  const dspByLine = new Map<string, string>();
  for (const d of disputes as unknown as Array<Record<string, unknown>>) {
    if (!dspByLine.has(sstr(d.billing_line_id))) dspByLine.set(sstr(d.billing_line_id), sstr(d.status));
  }
  for (const l of lines) l.dispute_status = dspByLine.get(sstr(l.billing_line_id)) ?? null;

  let statement: Record<string, unknown> | null = null;
  if (statementId) {
    const { data: st } = await admin.from('statements')
      .select('id, forwarder_id, warehouse_id, period_from, period_to, currency, total_amount, line_count, status, source, file_ref, imported_at, audited_at, closed_at, notes')
      .eq('user_id', userId).eq('id', statementId).maybeSingle();
    statement = (st as Record<string, unknown>) ?? null;
  }

  return {
    status: 200,
    body: {
      ok: true,
      batch: shapeBatch(b),
      statement,
      summary: payload.summary ?? null,
      write: payload.write ?? null,
      unknown_headers: payload.unknown_headers ?? [],
      ragged_rows: payload.ragged_rows ?? [],
      errors: payload.errors ?? [],
      warnings: payload.warnings ?? [],
      unmatched: payload.unmatched ?? [],
      lines,
      lines_truncated: !!((payload.write as Record<string, unknown>)?.rows_truncated),
      disputes: disputes ?? [],
    },
  };
}

// =====================================================================
// action = match —— 手工指定货件后重新匹配并回写差异
// =====================================================================
async function actMatch(admin: Admin, userId: string, body: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  const batchId = sstr(body.batch_id);
  const rowNo = Number(body.row_no);
  const shipmentId = sstr(body.shipment_id);
  const billingLineId = sstr(body.billing_line_id);
  if (!batchId || !Number.isFinite(rowNo)) return errBody('ARG_REQUIRED', '缺少 batch_id 或 row_no');
  if (!shipmentId && !billingLineId) return errBody('ARG_REQUIRED', 'shipment_id 与 billing_line_id 至少给一个');

  const { data: b, error: bErr } = await admin.from('statement_import_batches')
    .select('id, statement_id, batch_no, error_detail').eq('user_id', userId).eq('id', batchId).maybeSingle();
  if (bErr) return errBody('BATCH_QUERY_FAILED', `查询批次失败：${bErr.message}`);
  if (!b) return { status: 404, body: { ok: false, code: 'BATCH_NOT_FOUND', message: '批次不存在或不属于当前账号' } };
  const statementId = sstr((b as Record<string, unknown>).statement_id);
  if (!statementId) return errBody('STATEMENT_MISSING', '该批次还没有生成对账单，无法手工匹配');
  const payload = ((b as Record<string, unknown>).error_detail && typeof (b as Record<string, unknown>).error_detail === 'object')
    ? (b as Record<string, unknown>).error_detail as Record<string, unknown> : {};
  const storedRows = Array.isArray(payload.rows) ? payload.rows as Array<Record<string, unknown>> : [];
  const row = storedRows.find((r) => Number(r.row_no) === rowNo);
  if (!row) return { status: 404, body: { ok: false, code: 'ROW_NOT_FOUND', message: `批次里没有第 ${rowNo} 行（只保留了 ${storedRows.length} 行，超限部分不落库）` } };

  let target: BillingRow | null = null;
  if (billingLineId) {
    const { data } = await admin.from('billing_lines').select(BILL_SELECT).eq('user_id', userId).eq('id', billingLineId).maybeSingle();
    target = (data as unknown as BillingRow) ?? null;
    if (!target) return { status: 404, body: { ok: false, code: 'BILLING_LINE_NOT_FOUND', message: '费用行不存在或不属于当前账号' } };
    if (shipmentId && sstr(target.shipment_id) !== shipmentId) {
      return errBody('SHIPMENT_LINE_MISMATCH', `费用行 ${target.id.slice(0, 8)} 不属于该货件`);
    }
  } else {
    const { data: sh } = await admin.from('shipments').select(SHIP_SELECT).eq('user_id', userId).eq('id', shipmentId).maybeSingle();
    if (!sh) return { status: 404, body: { ok: false, code: 'SHIPMENT_NOT_FOUND', message: '货件不存在或不属于当前账号' } };
    const { data: bls } = await admin.from('billing_lines').select(BILL_SELECT).eq('user_id', userId).eq('shipment_id', shipmentId).limit(200);
    const pool = ((bls ?? []) as unknown as BillingRow[]).filter((l) => isEffective(l.status));
    if (!pool.length) return errBody('NO_BILLING_LINE', '该货件名下没有可参与对账的费用行（已排除 voided/rejected）');
    if (pool.length > 1) {
      return {
        status: 422,
        body: {
          ok: false, code: 'BILLING_LINE_AMBIGUOUS', message: `该货件有 ${pool.length} 条费用行，请再指定 billing_line_id`,
          details: { candidates: pool.map((l) => ({ billing_line_id: l.id, fee_type: l.fee_type, charge_type: l.charge_type, amount: sstr(l.amount), status: l.status, currency: l.currency })) },
        },
      };
    }
    target = pool[0];
  }
  if (!isEffective(target.status)) return errBody('LINE_NOT_EFFECTIVE', `费用行状态为 ${target.status}，不参与对账`);

  // 手工挂单同样受作废闸门约束：预览拒了的行，不能靠 match 绕进对账单
  const sidCheck = sstr(target.shipment_id) || shipmentId;
  if (sidCheck) {
    const { data: shChk } = await admin.from('shipments')
      .select('id, doc_status, stage, intercept_state').eq('user_id', userId).eq('id', sidCheck).maybeSingle();
    if (shChk && sstr((shChk as Record<string, unknown>).doc_status) === 'cancelled') {
      return errBody('SHIPMENT_VOIDED',
        `货件 ${sstr((shChk as Record<string, unknown>).id).slice(0, 8)} 已作废（doc_status=cancelled，`
        + `拦截状态：${sstr((shChk as Record<string, unknown>).intercept_state) || '-'}），不允许手工挂到对账单；`
        + `确属作废前已发生的费用请开争议单，不要改单据状态`);
    }
  }

  // 回写关联 + 称重（同 commit 的纪律：不动 amount）
  const { error: slErr } = await admin.from('statement_lines')
    .upsert({ statement_id: statementId, billing_line_id: target.id, user_id: userId, source: 'import' }, { onConflict: 'statement_id,billing_line_id' });
  if (slErr) return errBody('STATEMENT_LINE_UPSERT_FAILED', `挂单失败：${slErr.message}`);

  const patch: Record<string, unknown> = { statement_id: statementId };
  let locked = false;
  const wChargedRaw = sstr(row.weight_charged_g);
  const shipR = await admin.from('shipments').select('declared_weight_g').eq('user_id', userId).eq('id', sstr(target.shipment_id)).maybeSingle();
  const shipDeclared = shipR.data?.declared_weight_g != null ? strToUnits(sstr(shipR.data.declared_weight_g), G_SCALE) : null;
  const curWCharged = target.weight_charged_g != null ? strToUnits(sstr(target.weight_charged_g), G_SCALE) : null;
  const curWDeclared = target.weight_declared_g != null ? strToUnits(sstr(target.weight_declared_g), G_SCALE) : null;
  const wantCharged = wChargedRaw ? strToUnits(wChargedRaw, G_SCALE) : null;
  if (wantCharged !== null && wantCharged !== curWCharged) {
    if (target.status === 'approved') locked = true;
    else patch.weight_charged_g = fixed(wantCharged, G_SCALE, QTY_DP);
  }
  if (curWDeclared === null && shipDeclared !== null && target.status !== 'approved') {
    patch.weight_declared_g = fixed(shipDeclared, G_SCALE, QTY_DP);
  }
  const { error: upErr } = await admin.from('billing_lines').update(patch).eq('id', target.id).eq('user_id', userId);
  if (upErr) return errBody('BILLING_LINE_UPDATE_FAILED', `回写失败：${upErr.message}`);

  // 同步刷新存量，保证 batch_detail / export 读得到
  row.match_status = 'matched';
  row.billing_line_id = target.id;
  row.shipment_id = sstr(target.shipment_id) || shipmentId || null;
  row.line_status = target.status;
  row.fee_type = target.fee_type;
  row.charge_type = sstr(target.charge_type) || sstr(row.charge_type);
  row.currency = target.currency;
  row.declared_amount = sstr(target.amount);
  const d = diffFields(
    sstr(row.charged_amount) ? strToUnits(sstr(row.charged_amount), AMT_SCALE) : null,
    patch.weight_charged_g ? strToUnits(sstr(patch.weight_charged_g), G_SCALE) : wantCharged ?? curWCharged,
    null,
    {
      amount: sstr(target.amount),
      currency: target.currency,
      weight_declared_g: patch.weight_declared_g
        ? sstr(patch.weight_declared_g)
        : (curWDeclared !== null ? fixed(curWDeclared, G_SCALE, QTY_DP)
          : shipDeclared === null ? null : fixed(shipDeclared, G_SCALE, QTY_DP)),
    },
    null,
    sstr(row.currency) || 'CNY',
  );
  row.amount_diff = d.amount_diff;
  row.amount_diff_pct = d.amount_diff_pct;
  row.amount_diff_flag = d.amount_diff_flag;
  row.weight_declared_g = d.weight_declared_g;
  row.diff_flag = d.diff_flag;
  const prevErrors = Array.isArray(row.errors) ? row.errors as RowError[] : [];
  row.errors = prevErrors.filter((e) => e && e.code !== 'DUPLICATE_IN_BATCH');
  row.matched_manually = true;
  row.matched_at = nowIso();
  // 同一行的事实只能有一份：手工挂单成功后，把它从「未匹配」清单里摘掉，并按最新存量重算汇总
  const staleUnmatched = Array.isArray(payload.unmatched) ? (payload.unmatched as Array<Record<string, unknown>>) : [];
  await admin.from('statement_import_batches')
    .update({
      error_detail: {
        ...payload,
        rows: storedRows,
        unmatched: staleUnmatched.filter((r0) => Number(r0.row_no) !== rowNo),
        summary: buildSummary(storedRows as unknown as PreviewLine[]),
      },
    }).eq('id', batchId).eq('user_id', userId);

  let recalc: { total_amount: string; line_count: number } | null = null;
  const { data: rc, error: rcErr } = await admin.rpc('statement_recalc', { p_statement_id: statementId });
  if (!rcErr) {
    const r0 = Array.isArray(rc) ? rc[0] : rc;
    recalc = { total_amount: sstr((r0 as Record<string, unknown>)?.total_amount ?? '0'), line_count: Number((r0 as Record<string, unknown>)?.line_count ?? 0) };
  }

  return {
    status: 200,
    body: {
      ok: true, batch_id: batchId, row_no: rowNo, statement_id: statementId,
      line: row, weight_locked: locked,
      locked_note: locked ? `费用行 ${target.id.slice(0, 8)} 已审核，称重未回写（diff_flag 由库内触发器维护）` : null,
      recalc_error: rcErr ? rcErr.message : null,
      statement_recalc: recalc,
    },
  };
}

// =====================================================================
// action = dispute —— 开争议单 / 状态流转
// =====================================================================
const DSP_NEXT: Record<string, string[]> = {
  open: ['processing', 'accepted', 'rejected'],
  processing: ['accepted', 'rejected', 'closed'],
  accepted: ['closed'],
  rejected: ['closed'],
  closed: [],
};

async function actDispute(admin: Admin, userId: string, body: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  const mode = sstr(body.mode) || 'create';
  if (mode === 'create') {
    const statementId = sstr(body.statement_id);
    const billingLineId = sstr(body.billing_line_id);
    const reason = sstr(body.reason).trim();
    if (!statementId || !billingLineId) return errBody('ARG_REQUIRED', '缺少 statement_id 或 billing_line_id');
    if (!reason) return errBody('REASON_REQUIRED', '争议理由必填（货代沟通留痕）');
    const st = await admin.from('statements').select('id, status, currency').eq('user_id', userId).eq('id', statementId).maybeSingle();
    if (!st.data) return { status: 404, body: { ok: false, code: 'STATEMENT_NOT_FOUND', message: '对账单不存在或不属于当前账号' } };
    if (sstr(st.data.status) === 'closed') return errBody('STATEMENT_CLOSED', '对账单已关账，不能再开争议单');
    if (sstr(st.data.status) === 'voided') return errBody('STATEMENT_VOIDED', '对账单已作废');
    const bl = await admin.from('billing_lines').select(BILL_SELECT).eq('user_id', userId).eq('id', billingLineId).maybeSingle();
    if (!bl.data) return { status: 404, body: { ok: false, code: 'BILLING_LINE_NOT_FOUND', message: '费用行不存在或不属于当前账号' } };
    const line = bl.data as unknown as BillingRow;
    if (!isEffective(line.status)) return errBody('LINE_NOT_EFFECTIVE', `费用行状态为 ${line.status}，不能开争议单`);
    const exist = await admin.from('statement_disputes').select('id, status')
      .eq('user_id', userId).eq('statement_id', statementId).eq('billing_line_id', billingLineId)
      .in('status', ['open', 'processing']).limit(1);
    if ((exist.data ?? []).length) {
      return { status: 409, body: { ok: false, code: 'DISPUTE_ALREADY_OPEN', message: '该费用行已有未结争议单', details: { dispute_id: sstr((exist.data as Array<Record<string, unknown>>)[0].id) } } };
    }
    const claimed = amt(sstr(body.claimed_amount), false);
    if (sstr(body.claimed_amount) !== '' && !claimed.ok) return errBody('CLAIMED_AMOUNT_INVALID', `主张金额无法解析（${claimed.err}）`);
    const evRaw = body.evidence;
    const evidence: string[] = Array.isArray(evRaw) ? evRaw.map((x) => sstr(x)).filter(Boolean)
      : sstr(evRaw) === '' ? [] : sstr(evRaw).split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);
    const { data, error } = await admin.from('statement_disputes')
      .insert({
        statement_id: statementId, billing_line_id: billingLineId, user_id: userId,
        reason, claimed_amount: claimed.ok ? claimed.text : null,
        evidence, status: 'open', created_by: userId,
      }).select('*').maybeSingle();
    if (error) return errBody('DISPUTE_INSERT_FAILED', `创建争议单失败：${error.message}`);
    return { status: 200, body: { ok: true, mode: 'create', dispute: data, next_statuses: DSP_NEXT.open } };
  }

  if (mode === 'transition') {
    const disputeId = sstr(body.dispute_id);
    const next = sstr(body.status);
    if (!disputeId || !next) return errBody('ARG_REQUIRED', '缺少 dispute_id 或 status');
    if (!DSP_NEXT[next] && !['open', 'processing', 'accepted', 'rejected', 'closed'].includes(next)) {
      return errBody('STATUS_INVALID', `争议状态非法：${next}`);
    }
    const { data: cur, error: cErr } = await admin.from('statement_disputes')
      .select('id, statement_id, billing_line_id, status, resolved_at').eq('user_id', userId).eq('id', disputeId).maybeSingle();
    if (cErr) return errBody('DISPUTE_QUERY_FAILED', `查询争议单失败：${cErr.message}`);
    if (!cur) return { status: 404, body: { ok: false, code: 'DISPUTE_NOT_FOUND', message: '争议单不存在或不属于当前账号' } };
    const from = sstr((cur as Record<string, unknown>).status);
    const allowed = DSP_NEXT[from] ?? [];
    if (!allowed.includes(next)) {
      return { status: 422, body: { ok: false, code: 'TRANSITION_NOT_ALLOWED', message: `争议状态不能从 ${from} 流转到 ${next}`, details: { from, allowed_next: allowed } } };
    }
    const patch: Record<string, unknown> = { status: next };
    if (sstr(body.resolved_amount) !== '') {
      const ra = amt(sstr(body.resolved_amount), false);
      if (!ra.ok) return errBody('RESOLVED_AMOUNT_INVALID', `认定金额无法解析（${ra.err}）`);
      patch.resolved_amount = ra.text;
    }
    if (['accepted', 'rejected', 'closed'].includes(next)) {
      patch.resolved_by = userId;
      patch.resolved_at = nowIso();
    }
    const { data, error } = await admin.from('statement_disputes').update(patch).eq('id', disputeId).eq('user_id', userId).select('*').maybeSingle();
    if (error) return errBody('DISPUTE_UPDATE_FAILED', `更新争议单失败：${error.message}`);
    return { status: 200, body: { ok: true, mode: 'transition', from, to: next, dispute: data, next_statuses: DSP_NEXT[next] ?? [] } };
  }

  if (mode === 'list') {
    const statementId = sstr(body.statement_id);
    let q = admin.from('statement_disputes').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(500);
    if (statementId) q = q.eq('statement_id', statementId);
    const { data, error } = await q;
    if (error) return errBody('DISPUTE_LIST_FAILED', `查询争议单失败：${error.message}`);
    return { status: 200, body: { ok: true, disputes: data ?? [], transitions: DSP_NEXT } };
  }

  return errBody('MODE_UNKNOWN', `未知 dispute.mode: ${mode}`);
}

// =====================================================================
// action = export —— 把某批次差异行导出成 CSV 文本（回传给货代）
// =====================================================================
async function actExport(admin: Admin, userId: string, body: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  const batchId = sstr(body.batch_id);
  const batchNo = sstr(body.batch_no);
  if (!batchId && !batchNo) return errBody('BATCH_ID_REQUIRED', '缺少 batch_id 或 batch_no');
  const dr = await actBatchDetail(admin, userId, batchId ? { batch_id: batchId } : { batch_no: batchNo });
  if ((dr as { status: number }).status !== 200) return dr;
  const db = (dr as { body: Record<string, unknown> }).body;
  const lines = (db.lines ?? []) as unknown as PreviewLine[];
  const statementId = sstr((db.statement as Record<string, unknown> | null)?.id ?? '') || 'NA';
  const diffOnly = body.diff_only !== false;
  const out: string[][] = diffOnly
    ? buildDiffRowsForExport(lines)
    : [EXPORT_HEADERS.slice(), ...lines.map((l) => {
      const a = l as unknown as Record<string, unknown>;
      return [
        String(l.row_no), sstr(a.match_value), sstr(l.shipment_wms_order_no), '', l.fee_type ?? '', l.charge_type ?? '', '',
        l.currency, l.charged_amount ?? '', l.declared_amount ?? '', l.amount_diff ?? '',
        l.amount_diff_pct === null || l.amount_diff_pct === undefined ? '' : (Number(l.amount_diff_pct) / 100).toFixed(2),
        String(l.match_status), l.weight_charged_g ?? '', l.weight_declared_g ?? '',
        (l.errors ?? []).map((e) => e.message).join(' | '),
      ];
    })];
  // lines 里已经带着每行的最新状态（含"系统未匹配"），未匹配清单只用来补 lines 里没有的行，避免一票在回传给货代的表里出现两次
  const unmatched = (db.unmatched ?? []) as unknown as Array<Record<string, unknown>>;
  const seenRow = new Set(out.slice(1).map((r0) => r0[0]));
  for (const u of unmatched) {
    if (seenRow.has(sstr(u.row_no))) continue;
    seenRow.add(sstr(u.row_no));
    out.push([
      sstr(u.row_no), sstr(u.match_value), '', '', sstr(u.fee_type), sstr(u.charge_type), '',
      sstr(u.currency) || 'CNY', sstr(u.charged_amount), '', '', '',
      '系统未匹配', sstr(u.weight_charged_g), '',
      (u.errors as RowError[] | undefined)?.map((e) => e.message).join(' | ') ?? '',
    ]);
  }
  return {
    status: 200,
    body: {
      ok: true, batch_id: batchId || null, batch_no: batchNo || null, statement_id: statementId,
      file_name: `bill-diff-${batchNo || batchId || statementId}.csv`,
      csv_text: toCsv(out, ','), row_count: Math.max(out.length - 1, 0),
      diff_only: diffOnly,
    },
  };
}

// =====================================================================
// 主入口
// =====================================================================
const PERM_BY_ACTION: Record<string, string[]> = {
  template: ['logistics.reconcile.view'],
  preview: ['logistics.reconcile.view'],
  commit: ['logistics.billing.import'],
  list_batches: ['logistics.reconcile.view'],
  batch_detail: ['logistics.reconcile.view'],
  match: ['logistics.billing.audit'],
  dispute: ['logistics.billing.dispute'],
  export: ['logistics.reconcile.export'],
};

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  try {
    if (req.method === 'OPTIONS') return json({ ok: true }, 204);
    if (req.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED', message: '仅支持 POST 请求' }, 405);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = sstr(body.action);
    const need = PERM_BY_ACTION[action];
    if (!need || !need.length) {
      return json({ code: 'ACTION_UNKNOWN', message: `未知 action: ${action || '(空)'}`, details: { allowed: Object.keys(PERM_BY_ACTION) } }, 400);
    }

    const userId = await resolveUserId(req);
    if (!userId) return json({ code: 'UNAUTHENTICATED', message: '未登录或登录已过期' }, 401);

    // 权限闸门（fail-closed，全部在业务逻辑之前）
    for (const key of need) {
      const gate = await checkPerm(req, key);
      if (!gate.allowed) {
        console.warn(`[${functionName}] ${requestId} 权限拒绝 perm=${key} reason=${gate.error ?? 'denied'}`);
        return json({ code: 'PERMISSION_DENIED', message: `权限不足：${key}`, details: { perm_key: key, reason: gate.error ?? 'denied' } }, 403);
      }
    }

    const admin = adminClient();
    let r: { status: number; body: unknown };
    if (action === 'template') r = await actTemplate(admin, userId, body);
    else if (action === 'preview') r = await actPreview(admin, userId, body);
    else if (action === 'commit') r = await actCommit(admin, userId, body);
    else if (action === 'list_batches') r = await actListBatches(admin, userId, body);
    else if (action === 'batch_detail') r = await actBatchDetail(admin, userId, body);
    else if (action === 'match') r = await actMatch(admin, userId, body);
    else if (action === 'dispute') r = await actDispute(admin, userId, body);
    else r = await actExport(admin, userId, body);

    console.info(`[${functionName}] ${requestId} action=${action} user=${userId.slice(0, 8)} → ${r.status}`);
    return json(r.body, r.status);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[${functionName}] ${requestId} ${msg}`);
    return json({ code: 'INTERNAL_ERROR', message: msg }, 500);
  }
});
