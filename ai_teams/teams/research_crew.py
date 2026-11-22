"""
ResearchCrew - 研究调查团队
角色：高级研究员、事实核查员、综合分析师、报告撰写者

负责：从广泛信息收集到深度洞察报告的完整研究流程
"""
from crewai import Agent, Crew, Process, Task

from .base import BaseTeam, ensure_output_dir


class ResearchCrew(BaseTeam):
    """研究调查团队"""

    TEAM_NAME = "ResearchCrew"
    TEAM_DESC = "研究调查团队 - 信息收集、事实核查、深度分析"
    TEAM_VERSION = "1.0.0"

    # ========== Agents ==========
    def researcher(self) -> Agent:
        """高级研究员"""
        return Agent(
            role="Senior Researcher",
            goal="全面、准确地收集和整理目标主题的信息",
            backstory="""你是一位资深研究专家，拥有广泛的知识储备和极强的
            信息检索能力。你擅长使用多种渠道（学术文献、行业报告、
            权威媒体、官方数据）进行系统性研究。""",
            verbose=self.verbose,
            llm=self.llm,        )

    def fact_checker(self) -> Agent:
        """事实核查员"""
        return Agent(
            role="Fact-Check Specialist",
            goal="验证所有信息的准确性、时效性和来源可靠性",
            backstory="""你是一位严谨的事实核查专家，对信息来源有敏锐的
            判断力。你交叉验证不同来源的信息，标注信息的可信度等级，
            拒绝传播未经证实的说法。""",
            verbose=self.verbose,
            llm=self.llm,        )

    def analyst(self) -> Agent:
        """综合分析师"""
        return Agent(
            role="Research Analyst",
            goal="综合多源信息，发现模式、趋势和深层见解",
            backstory="""你是一位横向思维的分析专家，擅长从大量信息中
            识别关联、发现矛盾、预测趋势。你能将分散的信息整合成
            有逻辑、有深度的分析框架。""",
            verbose=self.verbose,
            llm=self.llm,        )

    def writer(self) -> Agent:
        """研究报告撰写者"""
        return Agent(
            role="Research Report Writer",
            goal="将研究成果组织成专业、清晰、易读的报告",
            backstory="""你是一位学术和商业报告撰写专家，擅长将复杂的
            研究成果以结构化、可读性强的方式呈现。你的报告总是
            逻辑清晰、证据充分、结论有说服力。""",
            verbose=self.verbose,
            llm=self.llm,        )

    # ========== Tasks ==========
    def collection_task(self) -> Task:
        """信息收集任务"""
        return Task(
            description="""针对以下主题进行广泛的信息收集：
{research_topic}

收集维度：
1. 核心概念和定义
2. 历史发展和重要里程碑
3. 当前现状和最新动态（近 1-2 年）
4. 主要观点和争论
5. 关键玩家和组织
6. 相关数据和统计""",
            expected_output="""结构化的信息清单，每条信息附带来源标注。""",
            agent=self.researcher(),
            output_file="output/research_collection.md",
        )

    def verification_task(self) -> Task:
        """事实核查任务"""
        return Task(
            description="""对收集的所有信息进行事实核查：
1. 检查来源可信度（官方 > 学术 > 权威媒体 > 其他）
2. 交叉验证关键数据和说法
3. 标注过时或可能不准确的信息
4. 标记存在争议的观点
5. 给出每条信息的可信度评级（A/B/C/D）""",
            expected_output="""核查后的信息清单，附可信度评级
和验证说明。""",
            agent=self.fact_checker(),
            context=[self.collection_task()],
            output_file="output/research_verified.md",
        )

    def analysis_task(self) -> Task:
        """综合分析任务"""
        return Task(
            description="""基于核查后的信息，进行深度综合分析：
1. 识别核心模式和趋势
2. 分析因果关系
3. 对比不同观点的论据
4. 识别信息空白和未解问题
5. 预测未来可能的发展方向""",
            expected_output="""深入的分析洞察，提供超越表面的
独到见解。""",
            agent=self.analyst(),
            context=[self.verification_task()],
            output_file="output/research_analysis.md",
        )

    def report_task(self) -> Task:
        """报告撰写任务"""
        return Task(
            description="""撰写一份完整的研究报告：
1. 执行摘要（一页纸概览）
2. 研究背景和目的
3. 方法论说明
4. 核心发现（分章节详述）
5. 深度分析和讨论
6. 结论和建议
7. 参考文献
8. 附录：原始数据""",
            expected_output="""一份结构完整、引用规范、
可直接用于决策的专业研究报告。""",
            agent=self.writer(),
            context=[self.verification_task(), self.analysis_task()],
            output_file="output/research_final_report.md",
        )

    # ========== Crew ==========
    def build_crew(self, **kwargs) -> Crew:
        """构建研究调查团队"""
        ensure_output_dir()
        return Crew(
            agents=[
                self.researcher(),
                self.fact_checker(),
                self.analyst(),
                self.writer(),
            ],
            tasks=[
                self.collection_task(),
                self.verification_task(),
                self.analysis_task(),
                self.report_task(),
            ],
            process=Process.sequential,
            verbose=self.verbose,
            llm=self.llm,        )


def quick_research(topic: str, verbose: bool = True):
    """快速运行研究流程"""
    crew = ResearchCrew(verbose=verbose)
    return crew.run({"research_topic": topic})
