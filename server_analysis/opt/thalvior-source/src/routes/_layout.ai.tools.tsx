import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Lightbulb, LineChart, ScanSearch, MessagesSquare } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AiToolPage } from "@/components/ai-tool-page";
import { PageHeader } from "@/components/page-header";

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
    title: "AI 自动选品",
    description: "输入品类或关键词，AI 生成选品建议（商品名、卖点、目标市场）",
    serviceKey: "ai_select",
    serviceName: "AI自动选品",
    inputLabel: "品类 / 关键词",
    placeholder: "例如：宠物用品、户外露营灯、厨房收纳...",
    systemPrompt:
      "你是跨境电商选品专家。请根据用户提供的品类或关键词，生成 3-5 个有潜力的选品建议，每个建议包含：商品名称、核心卖点、目标市场、预估客单价、竞争程度。用简洁的中文分点输出，直接给结果，不要解释过程。",
  },
  {
    key: "market",
    icon: LineChart,
    title: "AI 市场分析",
    description: "输入市场或品类，生成市场规模、趋势与竞争格局分析",
    serviceKey: "ai_market",
    serviceName: "AI市场分析",
    inputLabel: "市场 / 品类",
    placeholder: "例如：美国宠物市场、东南亚美妆、欧洲户外用品...",
    systemPrompt:
      "你是跨境电商市场分析师。请根据用户提供的市场或品类，生成一份结构化市场分析报告，包含：市场规模与增速、主要趋势、竞争格局、目标人群、进入机会与风险。用简洁的中文分点输出，直接给结果，不要解释过程。",
  },
  {
    key: "competitor",
    icon: ScanSearch,
    title: "AI 竞品分析",
    description: "输入竞品名或链接，生成竞品卖点、定价与优劣势分析",
    serviceKey: "ai_competitor",
    serviceName: "AI竞品分析",
    inputLabel: "竞品名称 / 链接",
    placeholder: "例如：某品牌宠物自动喂食器，或粘贴竞品商品链接...",
    systemPrompt:
      "你是跨境电商竞品分析专家。请根据用户提供的竞品名称或链接，生成竞品分析报告，包含：竞品核心卖点、定价策略、目标人群、用户评价亮点与槽点、相对优劣势、可借鉴的差异化机会。用简洁的中文分点输出，直接给结果，不要解释过程。",
  },
  {
    key: "review",
    icon: MessagesSquare,
    title: "AI 评价分析",
    description: "粘贴商品评论，AI 提取用户关注点、好评亮点与差评槽点",
    serviceKey: "ai_review",
    serviceName: "AI评价分析",
    inputLabel: "商品评论内容",
    placeholder: "粘贴多条商品评论，或输入商品链接让 AI 抓取评论...",
    systemPrompt:
      "你是跨境电商产品评论分析专家。请根据用户提供的商品评论，生成结构化分析：用户核心关注点、好评高频亮点、差评高频槽点、改进建议。用简洁的中文分点输出，直接给结果，不要解释过程。",
  },
];

function AiTools() {
  const [tab, setTab] = useState("select");
  const tool = TOOLS.find((x) => x.key === tab) ?? TOOLS[0];
  return (
    <div className="space-y-5">
      <PageHeader
        title="AI 工具"
        description="选品 · 市场 · 竞品 · 评价，AI 一站式分析"
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          {TOOLS.map((x) => (
            <TabsTrigger key={x.key} value={x.key}>
              <x.icon size={15} className="mr-1.5" />
              {x.title}
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
