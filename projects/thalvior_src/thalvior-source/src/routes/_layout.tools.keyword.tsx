import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Search, Copy, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/page-header";
import { requestLLMStream } from "@/services/aiService";
import { toast } from "sonner";
import { useLanguage } from "@/i18n/LanguageContext";
import { tt } from "@/i18n/tts";

export const Route = createFileRoute("/_layout/tools/keyword")({
  component: KeywordTool,
});

function KeywordTool() {
  const { t } = useLanguage();
  const [core, setCore] = useState("");
  const [loading, setLoading] = useState(false);
  const [keywords, setKeywords] = useState<string[]>([]);

  const generate = async () => {
    if (!core.trim()) {
      toast.error(t("tools.keyword.empty"));
      return;
    }
    setLoading(true);
    setKeywords([]);
    try {
      const prompt = tt('tools.kw.prompt', { core: core.trim() });
      const full = await requestLLMStream(
        [
          { role: "system", content: tt('tools.kw.sys') },
          { role: "user", content: prompt },
        ],
        () => {},
        { serviceKey: "keyword_mining" }
      );
      // 解析：按行拆分，去重，过滤空行与编号
      const list = Array.from(
        new Set(
          full
            .split("\n")
            .map((s) => s.replace(/^\s*[\d一二三四五六七八九十]+[.、)）]\s*/, "").trim())
            .filter((s) => s.length > 1 && !/^[#*\-—]+$/.test(s))
        )
      );
      setKeywords(list);
      if (list.length === 0) toast.info(t("tools.keyword.noResult"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("tools.keyword.fail"));
    } finally {
      setLoading(false);
    }
  };

  const copyAll = () => {
    navigator.clipboard.writeText(keywords.join("\n"));
    toast.success(t("tools.keyword.copied"));
  };

  // 按词根分组统计
  const groups = useMemo(() => {
    const map = new Map<string, string[]>();
    keywords.forEach((k) => {
      const root = k.split(" ")[0] || k;
      if (!map.has(root)) map.set(root, []);
      map.get(root)!.push(k);
    });
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [keywords]);

  return (
    <div className="space-y-5">
      <PageHeader title={t("nav.tools.keyword")} description={t("tools.keyword.desc")} />

      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Label className="mb-1.5 block text-sm">{t("tools.keyword.core")}</Label>
            <Input
              placeholder={t("tools.keyword.placeholder")}
              value={core}
              onChange={(e) => setCore(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && generate()}
            />
          </div>
          <Button onClick={generate} disabled={loading}>
            {loading ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
            {t("tools.keyword.generate")}
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t("tools.keyword.hint")}</p>
      </div>

      {keywords.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {t("tools.keyword.count", { count: keywords.length })}
            </p>
            <Button variant="outline" size="sm" onClick={copyAll}>
              <Copy size={14} className="mr-1" /> {t("tools.keyword.copyAll")}
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {groups.map(([root, list]) => (
              <div key={root} className="rounded-xl border border-border bg-card p-4 shadow-sm">
                <div className="mb-2 flex items-center gap-2">
                  <Search size={14} className="text-primary" />
                  <span className="text-sm font-semibold">{root}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {list.length}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {list.map((k) => (
                    <span
                      key={k}
                      className="rounded-md bg-muted/60 px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                    >
                      {k}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}