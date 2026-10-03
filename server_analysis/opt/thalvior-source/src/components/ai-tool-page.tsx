import { useEffect, useState } from "react";
import { Sparkles, Loader2, Send, Coins, History, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
import { toast } from "sonner";
import {
  requestLLMStream,
  getQuotaBalance,
  getServicePricing,
  formatPricing,
  saveAiHistory,
  getAiHistory,
  deleteAiHistory,
  type AiHistoryRow,
  type ServicePricing,
} from "@/services/aiService";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/i18n/LanguageContext";

// 通用 AI 能力页：输入 → 调用文本 LLM → 流式输出，调用前展示额度消耗，自动保存历史
export function AiToolPage({
  title,
  description,
  serviceKey,
  placeholder,
  systemPrompt,
  inputLabel = "输入内容",
  serviceName,
}: {
  title: string;
  description: string;
  serviceKey: string;
  placeholder: string;
  systemPrompt: string;
  inputLabel?: string;
  serviceName?: string;
}) {
  const { t } = useLanguage();
  const [input, setInput] = useState("");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [pricing, setPricing] = useState<ServicePricing | null>(null);
  const [lastCost, setLastCost] = useState<number | null>(null);
  const [history, setHistory] = useState<AiHistoryRow[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  const refreshBalance = () => {
    getQuotaBalance().then(setBalance).catch(() => setBalance(null));
  };

  const loadHistory = () => {
    getAiHistory(serviceKey).then(setHistory).catch(() => setHistory([]));
  };

  useEffect(() => {
    refreshBalance();
    getServicePricing(serviceKey).then(setPricing).catch(() => setPricing(null));
    loadHistory();
  }, [serviceKey]);

  const run = async () => {
    if (!input.trim()) {
      toast.error(`${t("ai.fillFirst")}${t(inputLabel)}`);
      return;
    }
    setBusy(true);
    setResult("");
    setLastCost(null);
    const balanceBefore = balance;
    try {
      const messages = [
        { role: "system" as const, content: systemPrompt },
        { role: "user" as const, content: input },
      ];
      let fullText = "";
      await requestLLMStream(messages, (chunk) => {
        fullText += chunk;
        setResult((prev) => prev + chunk);
      }, {
        serviceKey,
      });
      toast.success(t("ai.genDone"));
      // 真实消耗 = 调用前后的积分差值（服务端按 AI 积分扣费）
      const after = await getQuotaBalance().catch(() => null);
      const cost = balanceBefore !== null && after !== null ? balanceBefore - after : null;
      if (cost !== null) setLastCost(cost);
      // 保存历史（失败不阻断主流程）
      try {
        await saveAiHistory({
          serviceKey,
          serviceName: serviceName ?? title,
          inputText: input,
          outputText: fullText,
          cost: cost ?? 0,
        });
        loadHistory();
      } catch {
        // 静默忽略保存失败
      }
      refreshBalance();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("ai.genFail"));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteAiHistory(id);
      toast.success(t("notif.deleted"));
      loadHistory();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("notif.deleteFail"));
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t(title)}
        description={t(description)}
        actions={
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm">
            <Coins size={15} className="text-amber-500" />
            <span className="text-muted-foreground">{t("ai.balance")}</span>
            <span className="font-semibold">{balance === null ? "—" : `${balance} 积分`}</span>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* 输入区 */}
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <label className="mb-2 block text-sm font-medium">{t(inputLabel)}</label>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={8}
            placeholder={t(placeholder)}
            className="resize-none"
          />
          <div className="mt-3 space-y-1">
            <p className="text-xs text-muted-foreground">
              {formatPricing(pricing) || t("ai.freeThis")}
            </p>
            {lastCost !== null && (
              <p className="text-xs font-medium text-emerald-600">
                本次实际消耗 {lastCost} 积分
              </p>
            )}
          </div>
          <div className="mt-4 flex items-center justify-end">
            <Button onClick={run} disabled={busy}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              {busy ? t("ai.generating") : t("ai.startGen")}
            </Button>
          </div>
        </div>

        {/* 输出区 */}
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles size={16} className="text-primary" />
            <h3 className="text-sm font-semibold">{t("ai.output")}</h3>
          </div>
          {result ? (
            <div className="max-h-[420px] overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted/60 p-4 text-sm leading-relaxed">
              {result}
            </div>
          ) : (
            <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
              {busy ? t("ai.generatingWait") : t("ai.resultHere")}
            </div>
          )}
        </div>
      </div>

      {/* 历史记录 */}
      <div className="rounded-xl border border-border bg-card shadow-sm">
        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <History size={16} className="text-primary" />
          <h3 className="text-sm font-semibold">{t("ai.history")}</h3>
          <span className="text-xs text-muted-foreground">{t("ai.totalCount", { count: history.length })}</span>
        </div>
        {history.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">{t("ai.noHistory")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {history.map((h) => {
              const isOpen = expanded === h.id;
              return (
                <li key={h.id} className="px-5 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <button
                      onClick={() => setExpanded(isOpen ? null : h.id)}
                      className="flex min-w-0 flex-1 items-start gap-2 text-left"
                    >
                      {isOpen ? (
                        <ChevronUp size={15} className="mt-0.5 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronDown size={15} className="mt-0.5 shrink-0 text-muted-foreground" />
                      )}
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{h.input_text}</div>
                        <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                          <span>{new Date(h.created_at).toLocaleString()}</span>
                          <span className="text-amber-600">-{Number(h.cost).toFixed(2)} {t("ai.quota")}</span>
                        </div>
                      </div>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-rose-600 hover:text-rose-600"
                      onClick={() => handleDelete(h.id)}
                    >
                      <Trash2 size={15} />
                    </Button>
                  </div>
                  {isOpen && (
                    <div className="mt-3 space-y-2 pl-7">
                      <div>
                        <div className="mb-1 text-xs font-medium text-muted-foreground">{t("ai.input")}</div>
                        <div className="whitespace-pre-wrap rounded-lg bg-muted/60 p-3 text-xs leading-relaxed">{h.input_text}</div>
                      </div>
                      <div>
                        <div className="mb-1 text-xs font-medium text-muted-foreground">{t("ai.output")}</div>
                        <div className="whitespace-pre-wrap rounded-lg bg-muted/60 p-3 text-xs leading-relaxed">{h.output_text}</div>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}