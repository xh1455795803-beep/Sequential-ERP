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

import { tt } from "@/i18n/tts";
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
    name: "adm.et.welcomeTitle",
    desc: "adm.et.welcomeDesc",
    vars: [
      { key: "userName", label: "profile.username", sample: "adm.et.sampleName" },
      { key: "account", label: "adm.et.loginTitle", sample: "chenxm@foxmail.com" },
      { key: "systemUrl", label: "adm.et.systemAddress", sample: "https://thalvior.icu" },
    ],
  },
  {
    scene: "subscription_activated",
    name: "adm.et.subOpenTitle",
    desc: "adm.et.subOpenDesc",
    vars: [
      { key: "userName", label: "profile.username", sample: "adm.et.sampleName" },
      { key: "packageName", label: "adm.plan.name", sample: "adm.plan.proYearly" },
      { key: "startDate", label: "adm.plan.effectiveDate", sample: "2026-09-26" },
      { key: "endDate", label: "adm.plan.expireDate", sample: "2027-09-26" },
      { key: "aiTokenCount", label: "adm.et.aiQuotaTitle", sample: "12000" },
      { key: "systemUrl", label: "adm.et.systemAddress", sample: "https://thalvior.icu" },
    ],
  },
  {
    scene: "membership_expiring",
    name: "adm.et.expiryTitle",
    desc: "adm.et.expiryDesc",
    vars: [
      { key: "userName", label: "profile.username", sample: "adm.et.sampleName" },
      { key: "packageName", label: "adm.plan.name", sample: "adm.plan.proYearly" },
      { key: "expireDate", label: "adm.plan.expireDate", sample: "2026-10-03" },
      { key: "systemUrl", label: "adm.et.systemAddress", sample: "https://thalvior.icu" },
    ],
  },
  {
    scene: "login_alert",
    name: "adm.et.loginAlertTitle",
    desc: "adm.et.loginAlertDesc",
    vars: [
      { key: "userName", label: "profile.username", sample: "adm.et.sampleName" },
      { key: "loginTime", label: "adm.et.loginTime", sample: "2026-09-26 09:30:00" },
      { key: "loginIp", label: "adm.et.loginIp", sample: "203.0.113.42" },
      { key: "systemUrl", label: "adm.et.systemAddress", sample: "https://thalvior.icu" },
    ],
  },
  {
    scene: "quota_exhausted",
    name: "adm.et.quotaExhaustTitle",
    desc: "adm.et.quotaExhaustDesc",
    vars: [
      { key: "userName", label: "profile.username", sample: "adm.et.sampleName" },
      { key: "systemUrl", label: "adm.et.systemAddress", sample: "https://thalvior.icu" },
    ],
  },
  {
    scene: "register_code",
    name: "adm.et.regCodeTitle",
    desc: "adm.et.regCodeDesc",
    vars: [
      { key: "code", label: "auth.code", sample: "482913" },
      { key: "minutes", label: "adm.svc.validMinutes", sample: "5" },
    ],
  },
  {
    scene: "login_code",
    name: "adm.et.loginCodeTitle",
    desc: "adm.et.loginCodeDesc",
    vars: [
      { key: "code", label: "auth.code", sample: "482913" },
      { key: "minutes", label: "adm.svc.validMinutes", sample: "5" },
    ],
  },
  {
    scene: "reset_code",
    name: "adm.et.resetCodeTitle",
    desc: "adm.et.resetCodeDesc",
    vars: [
      { key: "code", label: "auth.code", sample: "482913" },
      { key: "minutes", label: "adm.svc.validMinutes", sample: "5" },
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
  if (!token) throw new Error(tt('common.notLoggedIn'));
  const res = await fetch(`${supabaseUrl}/functions/v1/mailer`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "OneDay-App-Id": projectUrlId },
    body: JSON.stringify({ accessToken: token, ...payload }),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || json.success === false) throw new Error(String(json.error ?? tt('adm.et.requestFail')));
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
      toast.error(tt('adm.et.subjectBodyRequired'));
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
      toast.success(tt('adm.et.saved'));
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tt('common.saveFail'));
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
      toast.success(tt('adm.et.resetDone'));
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tt('pd.restoreFailed'));
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
      if (!hit) { toast.error(tt('adm.et.noBuiltin')); return; }
      setSubject(hit.subject);
      setBody(hit.body);
      toast.success(tt('adm.et.builtinLoaded'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tt('adm.et.loadFail'));
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
        toast.warning(tt('adm.et.unresolvedVars', { v1: unresolved.join(", ") }));
      } else {
        toast.success(tt('adm.et.previewRefreshed'));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tt('adm.et.previewFail'));
    } finally {
      setPreviewing(false);
    }
  };

  const handleSendTest = async () => {
    setSending(true);
    try {
      const { data } = await supabase.auth.getSession();
      const email = data.session?.user?.email;
      if (!email) throw new Error(tt('common.notLoggedIn'));
      await callMailer({ action: "send", scene, email, lang, vars: sampleVars });
      toast.success(tt('adm.et.testSent', { email: email }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tt('adm.et.sendFail'));
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
        title={tt('admin.emailTemplates')}
        description={tt('adm.et.desc')}
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
                    <Badge variant="secondary" className="shrink-0 text-[10px]">{tt('adm.et.custom')}</Badge>
                  ) : (
                    <Badge variant="outline" className="shrink-0 text-[10px]">{tt('adm.plan.builtin')}</Badge>
                  )}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{s.desc}</p>
                <div className="mt-1.5 flex gap-1 text-[10px] text-muted-foreground">
                  <span>{tt('adm.et.zhShort')}{zh ? (zh.enabled ? tt('st.enabled') : tt('st.disabled')) : tt('adm.plan.builtin')}</span>
                  <span>·</span>
                  <span>{tt('adm.et.enShort')}{en ? (en.enabled ? tt('st.enabled') : tt('st.disabled')) : tt('adm.plan.builtin')}</span>
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
                  {tt("common.enable")}
                </label>
              </div>
            </div>
          </div>

          {!current && (
            <p className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              <Info size={14} className="mt-0.5 shrink-0" />
              {tt("exc.builtInNote")}
            </p>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">{tt('adm.et.subjectLabel')}</label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={tt('adm.et.subjectPh')} />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">{tt('adm.et.bodyLabel')}</label>
            <Textarea
              ref={bodyRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={12}
              className="font-data text-[13px] leading-relaxed"
              placeholder={tt('adm.etpl.bodyPh')}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">{tt('adm.et.varsHint')}</label>
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
              {tt("exc.saveApply")}
            </Button>
            <Button variant="outline" onClick={handleLoadBuiltin} disabled={saving}>
              {tt("exc.loadBuiltIn")}
            </Button>
            <Button variant="outline" onClick={handlePreview} disabled={previewing}>
              {previewing ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
              {tt("exc.refreshPreview")}
            </Button>
            <Button variant="outline" onClick={handleSendTest} disabled={sending}>
              {sending ? <Loader2 size={14} className="animate-spin" /> : <SendHorizonal size={14} />}
              {tt("exc.sendTest")}
            </Button>
            <Button variant="ghost" onClick={handleReset} disabled={saving || !current}>
              <RotateCcw size={14} />
              {tt("exc.restoreBuiltIn")}
            </Button>
          </div>

          {previewHtml && (
            <div className="space-y-1.5 border-t border-border pt-4">
              <label className="text-xs font-medium text-foreground">{tt('adm.et.livePreview')}</label>
              <iframe
                title={tt('adm.et.preview')}
                srcDoc={previewHtml}
                className="h-[420px] w-full rounded-lg border border-border bg-card"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
