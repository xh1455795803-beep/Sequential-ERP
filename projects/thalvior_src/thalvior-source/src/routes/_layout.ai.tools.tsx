import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Lightbulb, LineChart, ScanSearch, MessagesSquare } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AiToolPage } from "@/components/ai-tool-page";
import { PageHeader } from "@/components/page-header";

import { tt } from "@/i18n/tts";
import { useLanguage } from "@/i18n/LanguageContext";
export const Route = createFileRoute("/_layout/ai/tools")({
  component: AiTools,
});

/**
 * AI 工具聚合页：自动选品 / 市场分析 / 竞品分析 / 评价分析
 * 统一入口 + Tab 切换，服务按 serviceKey 独立计费与记录历史。
 */
const TOOLS = [
  {
    key: "select",
    icon: Lightbulb,
    title: "ai.tool.selTitle",
    description: "ai.tool.selDesc",
    serviceKey: "ai_select",
    serviceName: "ai.tool.selTag",
    inputLabel: "ai.tool.catKwPh",
    placeholder: "ai.tool.selPh",
    systemPrompt: tt('ai.tool.selling.prompt'),
  },
  {
    key: "market",
    icon: LineChart,
    title: "ai.tool.mktTitle",
    description: "ai.tool.mktDesc",
    serviceKey: "ai_market",
    serviceName: "ai.tool.mktTag",
    inputLabel: "ai.tool.mktCatPh",
    placeholder: "ai.tool.mktPh",
    systemPrompt: tt('ai.tool.market.prompt'),
  },
  {
    key: "competitor",
    icon: ScanSearch,
    title: "ai.tool.compTitle",
    description: "ai.tool.compDesc",
    serviceKey: "ai_competitor",
    serviceName: "ai.tool.compTag",
    inputLabel: "ai.tool.compNamePh",
    placeholder: "ai.tool.compPh",
    systemPrompt: tt('ai.tool.competitor.prompt'),
  },
  {
    key: "review",
    icon: MessagesSquare,
    title: "ai.tool.revTitle",
    description: "ai.tool.revDesc",
    serviceKey: "ai_review",
    serviceName: "ai.tool.revTag",
    inputLabel: "ai.tool.revLabel",
    placeholder: "ai.tool.revPh",
    systemPrompt: tt('ai.tool.review.prompt'),
  },
];

function AiTools() {
  const { t } = useLanguage();
  const [tab, setTab] = useState("select");
  const tool = TOOLS.find((x) => x.key === tab) ?? TOOLS[0];
  return (
    <div className="space-y-5">
      <PageHeader
        title={tt('nav.ai.tools')}
        description={tt('ai.toolsDesc')}
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          {TOOLS.map((x) => (
            <TabsTrigger key={x.key} value={x.key}>
              <x.icon size={15} className="mr-1.5" />
              {t(x.title)}
            </TabsTrigger>
          ))}
        </TabsList>
        {TOOLS.map((x) => (
          <TabsContent key={x.key} value={x.key} className="mt-4">
            <AiToolPage
              key={x.serviceKey}
              title={x.title}
              description={x.description}
              serviceKey={x.serviceKey}
              serviceName={x.serviceName}
              inputLabel={x.inputLabel}
              placeholder={x.placeholder}
              systemPrompt={x.systemPrompt}
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
