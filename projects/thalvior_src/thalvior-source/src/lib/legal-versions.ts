// 法务文档版本登记表 + 「注册时同意了哪一版」的写入（Wave A / T10，2026-11-17）
//
// 为什么需要这个文件
//   /terms、/privacy、/refund 三份文档本身是 nginx 静态页（/var/www/legal/*.html，wave B 维护），
//   SPA 里只有一个链接。真正缺的是证据：用户注册那一刻看到的到底是哪一版。
//   public.user_consents（migrations/zz_20261117_wA08_user_consents.sql）按
//   (user_id, kind, legal_version) 记账，legal_version 就是文档的生效日期。
//
// ⚠ 改文档必须同步改这里
//   版本号由 CHECK 限定为 YYYY-MM-DD：文档换了生效日期而这里没换，后果是
//   「记进去的版本用户其实没见过」。这两处必须同时改，且改完之后老版本号仍然要留在
//   表里（历史记账不删），新注册才用新版本 —— 追加式表天然支持，不需要迁移。
//
// 文案为什么写在本文件而不是 src/i18n/translations.ts
//   词典主文件由主会话统一接线、多波次并发编辑（目录下十几个 .bak.<wave> 就是证据），
//   合规文案在 wave B 手里也还在动。两条句子放这里，等 B 收敛后一次搬进 EXTRA_*，
//   搬动时 legalText() 的调用点不用改（key 不变）。链接文字复用已有词条
//   footer.terms / footer.privacy / footer.refund，不新增。

import { supabase } from "@/supabase/client";

export type LegalKind = "terms" | "privacy" | "refund";

/** kind -> 用户当时看到的文档生效日期（与 /var/www/legal/*.html 页脚的「生效日期」一致） */
export const LEGAL_VERSIONS: Record<LegalKind, string> = {
  terms: "2026-10-04",
  privacy: "2026-10-04",
  refund: "2026-10-04",
};

/** 静态法务页路径（nginx 直出，非 SPA 路由：新窗口打开，避免丢掉填了一半的表单） */
export const LEGAL_DOC_PATH: Record<LegalKind, string> = {
  terms: "/terms",
  privacy: "/privacy",
  refund: "/refund",
};

/** 复用现有 i18n 词条作为链接文案 */
export const LEGAL_DOC_LABEL_KEY: Record<LegalKind, string> = {
  terms: "footer.terms",
  privacy: "footer.privacy",
  refund: "footer.refund",
};

/** 注册这一步需要记录的同意的种类（退款规则属于支付前同意，由 billing 流程负责记录） */
export const SIGNUP_CONSENT_KINDS: LegalKind[] = ["terms", "privacy"];

const COPY: Record<string, { zh: string; en: string }> = {
  agreeLine: {
    zh: "我已阅读并同意",
    en: "I have read and agree to the",
  },
  agreeAnd: { zh: "和", en: "and" },
  agreeRequired: {
    zh: "请先阅读并同意《用户服务协议》和《隐私政策》",
    en: "Please read and accept the Terms of Service and the Privacy Policy first",
  },
  recordFail: {
    zh: "账号已创建，但同意记录未能写入，请重试一次",
    en: "Account created, but the consent record could not be written. Please retry.",
  },
  recordRetry: { zh: "重试记录同意", en: "Retry recording consent" },
};

export function legalText(lang: string, key: string): string {
  const entry = COPY[key];
  if (!entry) return key;
  return lang === "en" ? entry.en : entry.zh;
}

export type ConsentRecord = {
  kind: LegalKind;
  version: string;
  ok: boolean;
  error?: string;
};

export type ConsentOutcome = { ok: boolean; recorded: ConsentRecord[] };

/**
 * 把 SIGNUP_CONSENT_KINDS 逐项写进 user_consents。
 *
 * 走 record_user_consent() RPC 而不是直接 insert：user_id 由服务端 auth.uid() 决定，
 * 客户端无法替别人记账；user-agent / IP 也从请求头取，不取自请求体。
 * 失败不抛异常 —— 调用方（注册页）需要知道哪几项没记上并给出重试，而不是把刚建好的
 * 账号锁在门外。
 */
export async function recordSignupConsents(lang: string): Promise<ConsentOutcome> {
  const locale = lang === "en" ? "en" : "zh";
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const recorded: ConsentRecord[] = [];
  if (!user?.id) {
    return {
      ok: false,
      recorded: SIGNUP_CONSENT_KINDS.map((kind) => ({
        kind,
        version: LEGAL_VERSIONS[kind],
        ok: false,
        error: "no_session",
      })),
    };
  }

  for (const kind of SIGNUP_CONSENT_KINDS) {
    const version = LEGAL_VERSIONS[kind];
    const { data, error } = await supabase.rpc("record_user_consent", {
      p_kind: kind,
      p_legal_version: version,
      p_accepted: true,
      p_locale: locale,
    });
    if (error) {
      recorded.push({ kind, version, ok: false, error: error.message });
    } else if (!data || data.ok !== true) {
      recorded.push({ kind, version, ok: false, error: "unexpected_rpc_shape" });
    } else {
      recorded.push({ kind, version, ok: true });
    }
  }

  return { ok: recorded.every((r) => r.ok), recorded };
}
