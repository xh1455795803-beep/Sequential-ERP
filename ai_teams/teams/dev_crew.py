"""
DevCrew - 软件开发团队
角色：架构师、开发工程师、代码审查员、测试工程师

负责：从需求分析到代码实现、审查、测试的完整开发流程
"""
from crewai import Agent, Crew, Process, Task

from .base import BaseTeam, ensure_output_dir


class DevCrew(BaseTeam):
    """软件开发团队 - 全栈 AI 开发小组"""

    TEAM_NAME = "DevCrew"
    TEAM_DESC = "软件开发团队 - 架构设计、代码实现、审查与测试"
    TEAM_VERSION = "1.0.0"

    # ========== Agents ==========
    def architect(self) -> Agent:
        """软件架构师 - 负责技术选型和架构设计"""
        return Agent(
            role="Senior Software Architect",
            goal="设计清晰、可扩展、可维护的软件架构",
            backstory="""你是一位拥有 15 年经验的资深软件架构师。你精通各种技术栈，
            擅长将业务需求转化为合理的技术方案。你注重系统的可扩展性、性能和安全性，
            同时也关心开发团队的工作效率。""",
            verbose=self.verbose,
            llm=self.llm,        )

    def developer(self) -> Agent:
        """全栈开发工程师 - 负责代码实现"""
        return Agent(
            role="Full-Stack Developer",
            goal="实现高质量、可测试、符合架构设计的代码",
            backstory="""你是一位全栈开发专家，精通 Python、JavaScript、TypeScript、
            Go 等多种语言。你遵循 Clean Code 原则，擅长编写清晰、优雅的代码，
            并始终考虑代码的可测试性和可维护性。""",
            verbose=self.verbose,
            llm=self.llm,        )

    def reviewer(self) -> Agent:
        """代码审查员 - 负责代码质量把关"""
        return Agent(
            role="Code Review Specialist",
            goal="确保代码质量，发现潜在问题，提出改进建议",
            backstory="""你是一位严谨的代码审查专家，对代码质量有极高的标准。
            你擅长发现代码中的 bug、性能问题、安全隐患和可维护性问题。
            你的审查意见总是建设性的，帮助团队持续进步。""",
            verbose=self.verbose,
            llm=self.llm,        )

    def tester(self) -> Agent:
        """测试工程师 - 负责编写和执行测试"""
        return Agent(
            role="Test Engineer",
            goal="编写全面的测试用例，确保代码质量和功能正确性",
            backstory="""你是一位经验丰富的测试工程师，精通单元测试、集成测试、
            端到端测试等多种测试方法。你擅长边界条件分析，能发现开发人员忽略的
            问题。你相信好的测试是软件质量的保障。""",
            verbose=self.verbose,
            llm=self.llm,        )

    # ========== Tasks ==========
    def architecture_task(self) -> Task:
        """架构设计任务"""
        return Task(
            description="""为以下需求设计软件架构：
{project_requirement}

请提供：
1. 技术栈选择及理由
2. 系统架构图描述（组件、模块、数据流）
3. 关键接口设计
4. 数据库设计建议
5. 部署架构
6. 性能和安全考虑""",
            expected_output="""一份完整的架构设计文档，包含技术选型、
系统架构、接口设计、数据模型和部署方案。""",
            agent=self.architect(),
            output_file="output/dev_architecture.md",
        )

    def implementation_task(self) -> Task:
        """代码实现任务"""
        return Task(
            description="""根据架构设计，实现以下功能模块：
{project_requirement}

请提供：
1. 完整的源代码实现
2. 代码注释和文档字符串
3. 依赖说明
4. 使用示例""",
            expected_output="""高质量的源代码，包含清晰的结构、
完整的注释和可直接运行的示例。""",
            agent=self.developer(),
            context=[self.architecture_task()],
            output_file="output/dev_implementation.md",
        )

    def review_task(self) -> Task:
        """代码审查任务"""
        return Task(
            description="""对实现的代码进行全面审查：
1. 检查代码风格和规范
2. 发现潜在 bug 和逻辑问题
3. 评估性能和安全性
4. 检查可维护性
5. 提出改进建议""",
            expected_output="""详细的代码审查报告，列出：
严重问题、一般问题、改进建议、亮点，
并按优先级排序。""",
            agent=self.reviewer(),
            context=[self.implementation_task()],
            output_file="output/dev_review.md",
        )

    def testing_task(self) -> Task:
        """测试用例编写任务"""
        return Task(
            description="""为实现的代码编写完整的测试套件：
1. 单元测试（覆盖率 > 80%）
2. 集成测试
3. 边界条件测试
4. 异常场景测试
5. 性能基准测试（如适用）""",
            expected_output="""完整的测试代码和测试计划，
包含测试用例说明和预期结果。""",
            agent=self.tester(),
            context=[self.implementation_task()],
            output_file="output/dev_tests.md",
        )

    # ========== Crew ==========
    def build_crew(self, **kwargs) -> Crew:
        """构建软件开发团队"""
        ensure_output_dir()
        return Crew(
            agents=[
                self.architect(),
                self.developer(),
                self.reviewer(),
                self.tester(),
            ],
            tasks=[
                self.architecture_task(),
                self.implementation_task(),
                self.review_task(),
                self.testing_task(),
            ],
            process=Process.sequential,
            verbose=self.verbose,
            llm=self.llm,        )


# ========== 便捷函数 ==========
def quick_build(requirement: str, verbose: bool = True):
    """快速运行完整开发流程"""
    crew = DevCrew(verbose=verbose)
    return crew.run({"project_requirement": requirement})
