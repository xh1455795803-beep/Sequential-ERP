import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Mail, Save, RotateCcw, Eye, SendHorizonal, Loader2, Info } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/supabase/client";
import { projectUrlId, supabaseUrl } from "@/supabase/client";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/email-templates")({
  component: EmailTemplates,
});

interface SceneMeta {
  scene: string;
  name: string;
  desc: string;
  vars: { key: string; label: string; sample: string }[];
}

// 场景元数据：变量说明与样例值（样例值仅用于在线预览与测试邮件）
const SCENES: SceneMeta[] = [
  {
    scene: "welcome",
    name: "注册成功欢迎邮件",
    desc: "用户完成注册后自动发送",
    vars: [
      { key: "userName", label: "用户名", sample: "陈晓明" },
      { key: "account", label: "登录账号", sample: "chenxm@foxmail.com" },
      { key: "systemUrl", label: "系统地址", sample: "https://thalvior.icu" },
    ],
  },
  {
    scene: "subscription_activated",
    name: "订阅套餐开通通知",
    desc: "支付成功、套餐开通后发送",
    vars: [
      { key: "userName", label: "用户名", sample: "陈晓明" },
      { key: "packageName", label: "套餐名称", sample: "专业版年费套餐" },
      { key: "startDate", label: "生效日期", sample: "2026-09-26" },
      { key: "endDate", label: "到期日期", sample: "2027-09-26" },
      { key: "aiTokenCount", label: "AI剩余额度", sample: "12000" },
      { key: "systemUrl", label: "系统地址", sample: "https://thalvior.icu" },
    ],
  },
  {
    scene: "membership_expiring",
    name: "会员到期提醒",
    desc: "每日扫描，套餐到期前 7 天内发送",
    vars: [
      { key: "userName", label: "用户名", sample: "陈晓明" },
      { key: "packageName", label: "套餐名称", sample: "专业版年费套餐" },
      { key: "expireDate", label: "到期日期", sample: "2026-10-03" },
      { key: "systemUrl", label: "系统地址", sample: "https://thalvior.icu" },
    ],
  },
  {
    scene: "login_alert",
    name: "账号登录安全通知",
    desc: "用户登录成功后发送（同账号 24 小时内只发一次）",
    vars: [
      { key: "userName", label: "用户名", sample: "陈晓明" },
      { key: "loginTime", label: "登录时间", sample: "2026-09-26 09:30:00" },
      { key: "loginIp", label: "登录 IP", sample: "203.0.113.42" },
      { key: "systemUrl", label: "系统地址", sample: "https://thalvior.icu" },
    ],
  },
  {
    scene: "quota_exhausted",
    name: "AI 额度耗尽提醒",
    desc: "AI 调用额度扣减至 0 时发送",
    vars: [
      { key: "userName", label: "用户名", sample: "陈晓明" },
      { key: "systemUrl", label: "系统地址", sample: "https://thalvior.icu" },
    ],
  },
  {
    scene: "register_code",
    name: "注册邮箱验证码",
    desc: "注册环节发送的验证码邮件",
    vars: [
      { key: "code", label: "验证码", sample: "482913" },
      { key: "minutes", label: "有效分钟数", sample: "5" },
    ],
  },
  {
    scene: "login_code",
    name: "登录邮箱验证码",
    desc: "验证码登录环节发送的邮件",
    vars: [
      { key: "code", label: "验证码", sample: "482913" },
      { key: "minutes", label: "有效分钟数", sample: "5" },
    ],
  },
  {
    scene: "reset_code",
    name: "重置密码邮箱验证码",
    desc: "找回密码环节发送的邮件",
    vars: [
      { key: "code", label: "验证码", sample: "482913" },
      { key: "minutes", label: "有效分钟数", sample: "5" },
    ],
  },
];

type LangKey = "zh" | "en";
interface TemplateRow {
  scene: string;
  lang: string;
  name: string;
  subject: string;
  body: string;
  enabled: boolean;
}

async function callMailer(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("未登录");
  const res = await fetch(`${supabaseUrl}/functions/v1/mailer`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "OneDay-App-Id": projectUrlId },
    body: JSON.stringify({ accessToken: token, ...payload }),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || json.success === false) throw new Error(String(json.error ?? "请求失败"));
  return json;
}

function EmailTemplates() {
  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [scene, setScene] = useState(SCENES[0].scene);
  const [lang, setLang] = useState<LangKey>("zh");

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const meta = useMemo(() => SCENES.find((s) => s.scene === scene) ?? SCENES[0], [scene]);
  const current = rows.find((r) => r.scene === scene && r.lang === lang);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("email_templates").select("*");
    setRows((data ?? []) as TemplateRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  // 切换场景/语言时载入当前已保存内容
  useEffect(() => {
    const row = rows.find((r) => r.scene === scene && r.lang === lang);
    setSubject(row?.subject ?? "");
    setBody(row?.body ?? "");
    setEnabled(row?.enabled ?? true);
    setPreviewHtml("");
  }, [rows, scene, lang]);

  const insertVar = (key: string) => {
    const token = `\${${key}}`;
    const el = bodyRef.current;
    if (!el) { setBody((b) => b + token); return; }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + token + body.slice(end));
    setTimeout(() => { el.focus(); el.selectionStart = el.selectionEnd = start + token.length; }, 0);
  };

  const sampleVars = useMemo(
    () => Object.fromEntries(meta.vars.map((v) => [v.key, v.sample])),
    [meta],
  );

  const handleSave = async () => {
    if (!subject.trim() || !body.trim()) {
      toast.error("主题与正文不能为空");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from("email_templates")
        .upsert(
          { scene, lang, name: meta.name, subject: subject.trim(), body, enabled },
          { onConflict: "scene,lang" },
        );
      if (error) throw error;
      toast.success("模板已保存，立即生效");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  // 删除记录 = 回退到系统内置模板
  const handleReset = async () => {
    setSaving(true);
    try {
      const { error } = await supabase.from("email_templates").delete().eq("scene", scene).eq("lang", lang);
      if (error) throw error;
      toast.success("已清除自定义内容，恢复为系统内置模板");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "恢复失败");
    } finally {
      setSaving(false);
    }
  };

  // 载入内置文案到编辑框（便于在其基础上修改）
  const handleLoadBuiltin = async () => {
    setSaving(true);
    try {
      const data = await callMailer({ action: "builtin", scene });
      const list = (data.builtin as Array<{ lang: string; subject: string; body: string }>) ?? [];
      const hit = list.find((x) => x.lang === lang);
      if (!hit) { toast.error("该场景没有内置文案"); return; }
      setSubject(hit.subject);
      setBody(hit.body);
      toast.success("已载入系统内置文案（尚未保存）");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "载入失败");
    } finally {
      setSaving(false);
    }
  };

  const handlePreview = async () => {
    setPreviewing(true);
    try {
      const data = await callMailer({
        action: "preview",
        scene,
        lang,
        vars: sampleVars,
        email: "",
      });
      setPreviewHtml(String(data.html ?? ""));
      const unresolved = (data.unresolved as string[]) ?? [];
      if (unresolved.length > 0) {
        toast.warning(`存在未识别变量：${unresolved.join(", ")}`);
      } else {
        toast.success("预览已刷新");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "预览失败");
    } finally {
      setPreviewing(false);
    }
  };

  const handleSendTest = async () => {
    setSending(true);
    try {
      const { data } = await supabase.auth.getSession();
      const email = data.session?.user?.email;
      if (!email) throw new Error("未登录");
      await callMailer({ action: "send", scene, email, lang, vars: sampleVars });
      toast.success(`测试邮件已发送至 ${email}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "发送失败");
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        code="MAILER"
        title="邮件模板"
        description="8 个系统邮件场景，支持中英双语、${变量} 插值、在线预览与测试发送。改完保存即时生效，无需重新发版。"
      />

      <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
        {/* 场景列表 */}
        <div className="space-y-2">
          {SCENES.map((s) => {
            const zh = rows.find((r) => r.scene === s.scene && r.lang === "zh");
            const en = rows.find((r) => r.scene === s.scene && r.lang === "en");
            const customEnabled = Boolean(zh || en);
            return (
              <button
                key={s.scene}
                onClick={() => setScene(s.scene)}
                className={cn(
                  "w-full rounded-xl border p-3 text-left transition-colors",
                  scene === s.scene
                    ? "border-primary bg-primary/5"
                    : "border-border bg-card hover:border-primary/40",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">{s.name}</span>
                  {customEnabled ? (
                    <Badge variant="secondary" className="shrink-0 text-[10px]">自定义</Badge>
                  ) : (
                    <Badge variant="outline" className="shrink-0 text-[10px]">内置</Badge>
                  )}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{s.desc}</p>
                <div className="mt-1.5 flex gap-1 text-[10px] text-muted-foreground">
                  <span>中 {zh ? (zh.enabled ? "启用" : "停用") : "内置"}</span>
                  <span>·</span>
                  <span>英 {en ? (en.enabled ? "启用" : "停用") : "内置"}</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* 编辑区 */}
        <div className="space-y-4 rounded-xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Mail size={16} className="text-primary" />
              <span className="text-sm font-semibold text-foreground">{meta.name}</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex rounded-lg bg-muted p-0.5 text-xs">
                {(["zh", "en"] as LangKey[]).map((l) => (
                  <button
                    key={l}
                    onClick={() => setLang(l)}
                    className={cn(
                      "rounded-md px-3 py-1.5 transition-colors",
                      lang === l ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
                    )}
                  >
                    {l === "zh" ? "中文" : "English"}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={enabled} onCheckedChange={setEnabled} id="tpl-enabled" />
                <label htmlFor="tpl-enabled" className="cursor-pointer text-xs text-muted-foreground select-none">
                  启用
                </label>
              </div>
            </div>
          </div>

          {!current && (
            <p className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              <Info size={14} className="mt-0.5 shrink-0" />
              该场景当前使用系统内置文案。填入内容并保存后即生效；停用或删除则自动回退到内置模板。
            </p>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">邮件主题</label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="如：【Thalvior】您的会员套餐已开通成功" />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">正文内容</label>
            <Textarea
              ref={bodyRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={12}
              className="font-data text-[13px] leading-relaxed"
              placeholder="支持 ${变量} 占位符，换行会被渲染为邮件中的换行"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">可用变量（点击插入到正文光标处）</label>
            <div className="flex flex-wrap gap-1.5">
              {meta.vars.map((v) => (
                <button
                  key={v.key}
                  onClick={() => insertVar(v.key)}
                  title={v.label}
                  className="rounded-md border border-border bg-muted/40 px-2 py-1 font-data text-xs transition-colors hover:border-primary/40 hover:text-primary"
                >
                  {"${" + v.key + "}"}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              保存并生效
            </Button>
            <Button variant="outline" onClick={handleLoadBuiltin} disabled={saving}>
              载入内置文案
            </Button>
            <Button variant="outline" onClick={handlePreview} disabled={previewing}>
              {previewing ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
              刷新预览
            </Button>
            <Button variant="outline" onClick={handleSendTest} disabled={sending}>
              {sending ? <Loader2 size={14} className="animate-spin" /> : <SendHorizonal size={14} />}
              发送测试邮件
            </Button>
            <Button variant="ghost" onClick={handleReset} disabled={saving || !current}>
              <RotateCcw size={14} />
              恢复内置
            </Button>
          </div>

          {previewHtml && (
            <div className="space-y-1.5 border-t border-border pt-4">
              <label className="text-xs font-medium text-foreground">实时预览（样例数据）</label>
              <iframe
                title="邮件预览"
                srcDoc={previewHtml}
                className="h-[420px] w-full rounded-lg border border-border bg-white"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
