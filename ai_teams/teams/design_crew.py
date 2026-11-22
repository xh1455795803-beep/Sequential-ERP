"""
DesignCrew - 产品设计团队
角色：产品经理、UX 研究员、交互设计师、视觉设计师

负责：从用户研究到产品原型的完整设计流程
"""
from crewai import Agent, Crew, Process, Task

from .base import BaseTeam, ensure_output_dir


class DesignCrew(BaseTeam):
    """产品设计团队"""

    TEAM_NAME = "DesignCrew"
    TEAM_DESC = "产品设计团队 - 用户研究、交互设计、视觉设计、原型"
    TEAM_VERSION = "1.0.0"

    # ========== Agents ==========
    def product_manager(self) -> Agent:
        """产品经理"""
        return Agent(
            role="Product Manager",
            goal="定义清晰的产品愿景和路线图，确保产品解决真实用户问题",
            backstory="""你是一位资深产品经理，精通用户故事地图、
            优先级框架（RICE/MoSCoW）、指标驱动开发。你善于平衡
            用户价值、技术可行性和业务目标。""",
            verbose=self.verbose,
        )

    def ux_researcher(self) -> Agent:
        """UX 研究员"""
        return Agent(
            role="UX Researcher",
            goal="深入理解用户需求、行为和痛点，用数据指导设计决策",
            backstory="""你是一位 UX 研究专家，精通定性和定量研究方法，
            包括用户访谈、问卷调查、可用性测试、数据分析。你总能从
            用户行为中发现洞察，用证据而非直觉驱动设计。""",
            verbose=self.verbose,
        )

    def interaction_designer(self) -> Agent:
        """交互设计师"""
        return Agent(
            role="Interaction Designer",
            goal="设计清晰、直觉、愉悦的用户交互流程",
            backstory="""你是一位交互设计专家，精通用户旅程地图、
            信息架构、线框图、原型设计。你关注每个交互细节，
            让复杂的操作变得简单自然。""",
            verbose=self.verbose,
        )

    def visual_designer(self) -> Agent:
        """视觉设计师"""
        return Agent(
            role="UI/Visual Designer",
            goal="创建美观、一致、符合品牌调性的视觉设计",
            backstory="""你是一位全栈视觉设计专家，精通设计系统、
            组件库、响应式设计、品牌视觉。你相信好的设计不仅好看，
            更能提升体验和转化率。""",
            verbose=self.verbose,
        )

    # ========== Tasks ==========
    def discovery_task(self) -> Task:
        """需求发现任务"""
        return Task(
            description="""进行产品需求发现：
{product_concept}

请提供：
1. 用户画像（Persona）
2. 用户痛点和需求（按优先级排序）
3. 竞争产品分析
4. 产品核心价值主张
5. 成功指标（北极星指标 + 辅助指标）
6. MVP 范围定义""",
            expected_output="""产品发现文档，包含用户画像、
需求列表、竞争分析和 MVP 定义。""",
            agent=self.product_manager(),
            output_file="output/design_discovery.md",
        )

    def research_task(self) -> Task:
        """用户研究任务"""
        return Task(
            description="""设计用户研究方案并执行：
1. 研究目标和假设
2. 研究方法选择（访谈/问卷/可用性测试）
3. 研究大纲/问卷设计
4. 招募和样本策略
5. 数据分析方法
6. 伦理考量和隐私保护""",
            expected_output="""完整的研究计划和分析框架，
可直接用于执行用户研究。""",
            agent=self.ux_researcher(),
            context=[self.discovery_task()],
            output_file="output/design_research_plan.md",
        )

    def ix_task(self) -> Task:
        """交互设计任务"""
        return Task(
            description="""设计核心交互流程：
1. 用户旅程地图（User Journey Map）
2. 信息架构（Information Architecture）
3. 主要页面/流程的线框图（文字描述）
4. 关键交互模式（手势、过渡、反馈）
5. 错误处理和空状态设计
6. 无障碍设计考虑""",
            expected_output="""完整的交互设计规范，包含
用户旅程、信息架构和线框图描述。""",
            agent=self.interaction_designer(),
            context=[self.discovery_task()],
            output_file="output/design_interaction.md",
        )

    def visual_task(self) -> Task:
        """视觉设计任务"""
        return Task(
            description="""制定视觉设计规范：
1. 设计系统概述（颜色、字体、间距、圆角、阴影）
2. 组件库规范（按钮、输入框、卡片、导航等）
3. 品牌调性和风格指南
4. 响应式断点和适配策略
5. 暗模式（如适用）
6. 可访问性检查（对比度、字号）""",
            expected_output="""完整的视觉设计规范文档，
可直接用于开发实现。""",
            agent=self.visual_designer(),
            context=[self.ix_task()],
            output_file="output/design_visual.md",
        )

    # ========== Crew ==========
    def build_crew(self, **kwargs) -> Crew:
        """构建产品设计团队"""
        ensure_output_dir()
        return Crew(
            agents=[
                self.product_manager(),
                self.ux_researcher(),
                self.interaction_designer(),
                self.visual_designer(),
            ],
            tasks=[
                self.discovery_task(),
                self.research_task(),
                self.ix_task(),
                self.visual_task(),
            ],
            process=Process.sequential,
            verbose=self.verbose,
        )


def quick_design(concept: str, verbose: bool = True):
    """快速生成产品设计方案"""
    crew = DesignCrew(verbose=verbose)
    return crew.run({"product_concept": concept})
