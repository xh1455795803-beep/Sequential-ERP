"""
ContentCrew - 内容创作团队
角色：策划者、撰稿人、编辑、SEO 专家

负责：从内容策划到最终发布的完整内容生产流程
"""
from crewai import Agent, Crew, Process, Task

from .base import BaseTeam, ensure_output_dir


class ContentCrew(BaseTeam):
    """内容创作团队"""

    TEAM_NAME = "ContentCrew"
    TEAM_DESC = "内容创作团队 - 策划、撰稿、编辑、SEO 优化"
    TEAM_VERSION = "1.0.0"

    # ========== Agents ==========
    def strategist(self) -> Agent:
        """内容策划者"""
        return Agent(
            role="Content Strategist",
            goal="制定清晰、有针对性的内容策略和大纲",
            backstory="""你是一位资深内容策略专家，擅长将品牌定位、
            目标受众分析、内容形式选择结合起来。你能为任何主题设计出
            结构清晰、有吸引力的内容大纲。""",
            verbose=self.verbose,
            llm=self.llm,        )

    def writer(self) -> Agent:
        """撰稿人"""
        return Agent(
            role="Professional Writer",
            goal="撰写引人入胜、信息丰富、符合目标读者需求的内容",
            backstory="""你是一位多才多艺的专业写作者，擅长博客文章、
            营销文案、技术文档、社交媒体内容等多种形式。你的文字流畅、
            有说服力，总能抓住读者的注意力。""",
            verbose=self.verbose,
            llm=self.llm,        )

    def editor(self) -> Agent:
        """编辑"""
        return Agent(
            role="Senior Editor",
            goal="确保内容的准确性、流畅性和专业水准",
            backstory="""你是一位经验丰富的资深编辑，对文字有极高的敏感度。
            你擅长发现逻辑漏洞、事实错误、语法问题，并在保持原文风格的
            同时提升内容质量。""",
            verbose=self.verbose,
            llm=self.llm,        )

    def seo_specialist(self) -> Agent:
        """SEO 专家"""
        return Agent(
            role="SEO & Content Optimizer",
            goal="优化内容以提升搜索引擎排名和读者参与度",
            backstory="""你是一位 SEO 和内容优化专家，精通关键词研究、
            元数据优化、可读性分析。你能在保持内容质量的前提下，
            让更多目标读者看到它。""",
            verbose=self.verbose,
            llm=self.llm,        )

    # ========== Tasks ==========
    def strategy_task(self) -> Task:
        """内容策略任务"""
        return Task(
            description="""为以下主题制定内容策略：
{content_topic}

请提供：
1. 目标受众画像
2. 内容形式建议（文章、视频脚本、社交媒体系列等）
3. 核心信息和论点
4. 文章大纲（一级、二级标题）
5. 参考关键词和主题标签""",
            expected_output="""完整的内容策略文档，包含受众分析、
结构大纲和优化要点。""",
            agent=self.strategist(),
            output_file="output/content_strategy.md",
        )

    def writing_task(self) -> Task:
        """撰稿任务"""
        return Task(
            description="""根据策略大纲，撰写完整的内容：
- 目标字数：{target_words} 字
- 语气风格：{tone}
- 内容目的：{purpose}

要求：
1. 标题吸引人
2. 开头有钩子
3. 结构清晰，逻辑连贯
4. 适当使用例证和数据
5. 结尾有力的总结或行动召唤""",
            expected_output="""完整的、可直接发布的高质量内容。""",
            agent=self.writer(),
            context=[self.strategy_task()],
            output_file="output/content_draft.md",
        )

    def editing_task(self) -> Task:
        """编辑审核任务"""
        return Task(
            description="""对内容进行全面编辑审核：
1. 检查事实准确性
2. 修正语法和拼写
3. 优化句子流畅度
4. 确保逻辑严密性
5. 增强表达力和吸引力
6. 删减冗余内容""",
            expected_output="""编辑后的最终版内容，附修改说明清单。""",
            agent=self.editor(),
            context=[self.writing_task()],
            output_file="output/content_edited.md",
        )

    def seo_task(self) -> Task:
        """SEO 优化任务"""
        return Task(
            description="""对编辑后的内容进行 SEO 优化：
1. 关键词自然融入（密度 1-2%）
2. 优化标题和副标题（含主关键词）
3. 编写元描述（150-160 字符）
4. 建议图片 ALT 文本
5. 添加内链建议
6. 优化段落长度和可读性""",
            expected_output="""SEO 优化后的内容，附带元数据
和发布建议。""",
            agent=self.seo_specialist(),
            context=[self.editing_task()],
            output_file="output/content_final.md",
        )

    # ========== Crew ==========
    def build_crew(self, **kwargs) -> Crew:
        """构建内容创作团队"""
        ensure_output_dir()
        return Crew(
            agents=[
                self.strategist(),
                self.writer(),
                self.editor(),
                self.seo_specialist(),
            ],
            tasks=[
                self.strategy_task(),
                self.writing_task(),
                self.editing_task(),
                self.seo_task(),
            ],
            process=Process.sequential,
            verbose=self.verbose,
            llm=self.llm,        )


def quick_content(topic: str, target_words: str = "1500",
                  tone: str = "专业但友好", purpose: str = "信息分享",
                  verbose: bool = True):
    """快速生成内容"""
    crew = ContentCrew(verbose=verbose)
    return crew.run({
        "content_topic": topic,
        "target_words": target_words,
        "tone": tone,
        "purpose": purpose,
    })
