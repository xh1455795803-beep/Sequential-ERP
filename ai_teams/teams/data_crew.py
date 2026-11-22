"""
DataCrew - 数据分析团队
角色：数据工程师、数据分析师、统计学家、报告撰写者

负责：从数据获取到洞察报告的完整数据分析流程
"""
from crewai import Agent, Crew, Process, Task

from .base import BaseTeam, ensure_output_dir


class DataCrew(BaseTeam):
    """数据分析团队"""

    TEAM_NAME = "DataCrew"
    TEAM_DESC = "数据分析团队 - 数据清洗、统计分析、可视化洞察"
    TEAM_VERSION = "1.0.0"

    # ========== Agents ==========
    def engineer(self) -> Agent:
        """数据工程师 - 负责数据获取和清洗"""
        return Agent(
            role="Data Engineer",
            goal="获取、清洗并准备高质量的可分析数据",
            backstory="""你是一位数据工程专家，精通 ETL 流程、数据管道设计、
            SQL 和 Python 数据处理。你擅长从各种数据源（数据库、API、文件、爬虫）
            获取数据，并进行清洗、转换和特征工程。你追求数据质量的极致。""",
            verbose=self.verbose,
            llm=self.llm,        )

    def analyst(self) -> Agent:
        """数据分析师 - 负责探索性分析"""
        return Agent(
            role="Data Analyst",
            goal="深入探索数据，发现有价值的模式和趋势",
            backstory="""你是一位资深数据分析师，擅长探索性数据分析（EDA）。
            你精通 Pandas、NumPy、SQL 等工具，善于从数据中发现隐藏的模式、
            异常值和业务洞察。你相信每个数据点背后都有故事。""",
            verbose=self.verbose,
            llm=self.llm,        )

    def statistician(self) -> Agent:
        """统计学家 - 负责高级统计分析"""
        return Agent(
            role="Statistical Scientist",
            goal="运用严谨的统计方法验证假设、建立模型",
            backstory="""你是一位统计学博士，精通假设检验、回归分析、
            贝叶斯方法、机器学习建模。你擅长将业务问题转化为统计问题，
            并给出可信、可解释的分析结论。""",
            verbose=self.verbose,
            llm=self.llm,        )

    def reporter(self) -> Agent:
        """报告撰写者 - 负责结果呈现"""
        return Agent(
            role="Business Intelligence Reporter",
            goal="将数据分析结果转化为清晰、有说服力的业务报告",
            backstory="""你是一位 BI 报告专家，擅长将复杂的数据分析结果
            以清晰、直观的方式呈现给业务决策者。你精通数据可视化原理，
            能选择最合适的图表和格式来传达关键洞察。""",
            verbose=self.verbose,
            llm=self.llm,        )

    # ========== Tasks ==========
    def data_prep_task(self) -> Task:
        """数据准备任务"""
        return Task(
            description="""处理以下数据分析需求的数据准备工作：
{analysis_topic}

请提供：
1. 数据获取方案（数据源、API、SQL 查询等）
2. 数据清洗策略（缺失值、异常值、重复值处理）
3. 特征工程方案
4. 最终可用的数据描述（字段、类型、样本量）""",
            expected_output="""完整的数据准备方案，包含数据来源、
清洗代码、转换逻辑和数据字典。""",
            agent=self.engineer(),
            output_file="output/data_preparation.md",
        )

    def exploration_task(self) -> Task:
        """探索性分析任务"""
        return Task(
            description="""对数据进行深入的探索性分析：
1. 描述性统计（均值、中位数、分位数、分布）
2. 相关性分析
3. 异常值检测
4. 时间序列分析（如适用）
5. 分组对比分析
6. 关键发现和初步洞察""",
            expected_output="""详细的探索性分析报告，包含统计摘要、
关键图表说明和初步洞察。""",
            agent=self.analyst(),
            context=[self.data_prep_task()],
            output_file="output/data_exploration.md",
        )

    def modeling_task(self) -> Task:
        """统计建模任务"""
        return Task(
            description="""基于探索性分析发现，进行深入的统计建模：
1. 提出可验证的假设
2. 选择合适的统计方法或模型
3. 模型训练和验证
4. 结果解读和显著性检验
5. 模型局限性讨论""",
            expected_output="""完整的统计建模报告，包含假设、
方法、结果、解读和局限性。""",
            agent=self.statistician(),
            context=[self.exploration_task()],
            output_file="output/data_modeling.md",
        )

    def report_task(self) -> Task:
        """最终报告任务"""
        return Task(
            description="""将所有分析成果整合为一份完整的业务报告：
1. 执行摘要（3-5 句话概括核心发现）
2. 背景和目标
3. 数据概览
4. 关键发现（配图表描述）
5. 深度分析
6. 业务建议
7. 附录：方法说明""",
            expected_output="""一份专业、清晰、可直接用于决策的
数据分析业务报告。""",
            agent=self.reporter(),
            context=[self.data_prep_task(), self.exploration_task(), self.modeling_task()],
            output_file="output/data_final_report.md",
        )

    # ========== Crew ==========
    def build_crew(self, **kwargs) -> Crew:
        """构建数据分析团队"""
        ensure_output_dir()
        return Crew(
            agents=[
                self.engineer(),
                self.analyst(),
                self.statistician(),
                self.reporter(),
            ],
            tasks=[
                self.data_prep_task(),
                self.exploration_task(),
                self.modeling_task(),
                self.report_task(),
            ],
            process=Process.sequential,
            verbose=self.verbose,
            llm=self.llm,        )


def quick_analysis(topic: str, verbose: bool = True):
    """快速运行完整分析流程"""
    crew = DataCrew(verbose=verbose)
    return crew.run({"analysis_topic": topic})
