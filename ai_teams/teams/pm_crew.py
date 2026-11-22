"""
PMCrew - 项目管理团队
角色：项目经理、任务分解专家、进度协调员、风险管理专家

负责：项目规划、任务分解、进度跟踪、风险管理
"""
from crewai import Agent, Crew, Process, Task

from .base import BaseTeam, ensure_output_dir


class PMCrew(BaseTeam):
    """项目管理团队"""

    TEAM_NAME = "PMCrew"
    TEAM_DESC = "项目管理团队 - 规划、分解、协调、风险管控"
    TEAM_VERSION = "1.0.0"

    # ========== Agents ==========
    def manager(self) -> Agent:
        """项目经理"""
        return Agent(
            role="Project Manager",
            goal="制定清晰可行的项目计划，确保按时高质量交付",
            backstory="""你是一位 PMP 认证的资深项目经理，精通敏捷和瀑布
            两种方法论。你擅长利益相关者管理、资源协调、沟通推动，
            能够在约束条件下找到最优解。""",
            verbose=self.verbose,
        )

    def decomposer(self) -> Agent:
        """WBS 专家 - 任务分解"""
        return Agent(
            role="Work Breakdown Specialist",
            goal="将项目需求分解为可执行、可估算、可跟踪的具体任务",
            backstory="""你是一位 WBS（工作分解结构）专家，擅长将复杂项目
            逐层分解为最小可管理单元。你定义清晰的任务边界、依赖关系、
            交付标准和验收条件。""",
            verbose=self.verbose,
        )

    def coordinator(self) -> Agent:
        """进度协调员"""
        return Agent(
            role="Schedule & Resource Coordinator",
            goal="制定合理的时间线和资源分配方案，识别并解决瓶颈",
            backstory="""你是一位精通关键路径法（CPM）和资源平衡的
            进度管理专家。你能准确估算工期、识别任务依赖、
            发现资源冲突，并提出可行的调整方案。""",
            verbose=self.verbose,
        )

    def risk_manager(self) -> Agent:
        """风险管理专家"""
        return Agent(
            role="Risk Management Expert",
            goal="全面识别、评估项目风险，制定应对策略和应急预案",
            backstory="""你是一位经验丰富的风险管理专家，擅长定性和定量
            风险分析。你总能提前发现潜在问题，并准备好应对方案，
            让项目团队有备无患。""",
            verbose=self.verbose,
        )

    # ========== Tasks ==========
    def charter_task(self) -> Task:
        """项目章程任务"""
        return Task(
            description="""为以下项目制定项目章程：
{project_goal}

请提供：
1. 项目背景和业务价值
2. 明确的项目目标（SMART 原则）
3. 范围边界（包含/不包含）
4. 关键里程碑
5. 利益相关者清单
6. 初步预算和资源需求
7. 成功标准""",
            expected_output="""正式的项目章程文档，获得干系人批准的依据。""",
            agent=self.manager(),
            output_file="output/pm_charter.md",
        )

    def wbs_task(self) -> Task:
        """WBS 分解任务"""
        return Task(
            description="""将项目分解为完整的工作分解结构：
1. 一级阶段
2. 二级模块
3. 三级具体任务
4. 四级工作包（如需要）

每个工作包需包含：
- 任务名称和描述
- 负责角色/团队
- 前置依赖
- 估算工期
- 交付物
- 验收标准""",
            expected_output="""层次清晰的 WBS 表格，可导入
项目管理工具（Jira/Asana）。""",
            agent=self.decomposer(),
            context=[self.charter_task()],
            output_file="output/pm_wbs.md",
        )

    def schedule_task(self) -> Task:
        """进度计划任务"""
        return Task(
            description="""制定详细的项目进度计划：
1. 绘制甘特图（文字描述）
2. 识别关键路径
3. 资源分配（考虑角色技能矩阵）
4. 并行任务识别
5. 缓冲区设置
6. 每周/迭代规划建议""",
            expected_output="""详细的项目进度计划，包含时间线、
资源分配和关键路径分析。""",
            agent=self.coordinator(),
            context=[self.wbs_task()],
            output_file="output/pm_schedule.md",
        )

    def risk_task(self) -> Task:
        """风险管理任务"""
        return Task(
            description="""进行全面的项目风险分析：
1. 识别所有可能风险（技术、进度、资源、外部等）
2. 评估概率和影响（高/中/低）
3. 计算风险优先级（概率 × 影响）
4. 制定应对策略（规避/转移/缓解/接受）
5. 制定应急计划
6. 建立风险监控机制""",
            expected_output="""风险登记册，包含风险清单、评估、
应对措施和监控方案。""",
            agent=self.risk_manager(),
            context=[self.charter_task(), self.wbs_task()],
            output_file="output/pm_risk.md",
        )

    # ========== Crew ==========
    def build_crew(self, **kwargs) -> Crew:
        """构建项目管理团队"""
        ensure_output_dir()
        return Crew(
            agents=[
                self.manager(),
                self.decomposer(),
                self.coordinator(),
                self.risk_manager(),
            ],
            tasks=[
                self.charter_task(),
                self.wbs_task(),
                self.schedule_task(),
                self.risk_task(),
            ],
            process=Process.sequential,
            verbose=self.verbose,
        )


def quick_plan(goal: str, verbose: bool = True):
    """快速生成项目计划"""
    crew = PMCrew(verbose=verbose)
    return crew.run({"project_goal": goal})
