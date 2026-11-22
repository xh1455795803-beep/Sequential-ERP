"""
DevOpsCrew - DevOps 团队
角色：基础设施工程师、CI/CD 专家、安全工程师、监控专家

负责：从基础设施设计到持续交付和运维监控的完整 DevOps 流程
"""
from crewai import Agent, Crew, Process, Task

from .base import BaseTeam, ensure_output_dir


class DevOpsCrew(BaseTeam):
    """DevOps 团队"""

    TEAM_NAME = "DevOpsCrew"
    TEAM_DESC = "DevOps 团队 - 基础设施、CI/CD、安全、监控"
    TEAM_VERSION = "1.0.0"

    # ========== Agents ==========
    def infra_engineer(self) -> Agent:
        """基础设施工程师"""
        return Agent(
            role="Infrastructure Engineer",
            goal="设计可扩展、高可用、可观测的基础设施架构",
            backstory="""你是一位资深 SRE/Infra 工程师，精通云原生架构、
            Kubernetes、Terraform、IaC 等。你追求基础设施的一致性、
            可重现性和成本效率。""",
            verbose=self.verbose,
            llm=self.llm,        )

    def cicd_engineer(self) -> Agent:
        """CI/CD 专家"""
        return Agent(
            role="CI/CD Pipeline Engineer",
            goal="构建高效、可靠、安全的持续集成和持续交付管道",
            backstory="""你是一位 CI/CD 专家，精通 GitHub Actions、GitLab CI、
            Jenkins、ArgoCD 等工具链。你设计的管道能快速反馈、自动测试、
            安全部署，并最大化交付速度。""",
            verbose=self.verbose,
            llm=self.llm,        )

    def security_engineer(self) -> Agent:
        """DevSecOps 工程师"""
        return Agent(
            role="DevSecOps Engineer",
            goal="在开发和部署全流程中嵌入安全实践，构建安全第一道防线",
            backstory="""你是一位应用安全专家，擅长 SAST/DAST、容器安全、
            密钥管理、合规审计。你相信安全是每个人的责任，应左移到
            开发流程的最早阶段。""",
            verbose=self.verbose,
            llm=self.llm,        )

    def sre(self) -> Agent:
        """SRE - 可靠性/监控专家"""
        return Agent(
            role="Site Reliability Engineer",
            goal="建立完善的可观测性体系，确保系统可靠性和快速故障响应",
            backstory="""你是一位 SRE 专家，精通 Prometheus、Grafana、
            ELK、OpenTelemetry 等可观测性工具。你设计的监控告警系统
            能在问题影响用户之前发现它。""",
            verbose=self.verbose,
            llm=self.llm,        )

    # ========== Tasks ==========
    def infra_task(self) -> Task:
        """基础设施设计任务"""
        return Task(
            description="""为以下应用设计基础设施架构：
{application}

请提供：
1. 技术栈推荐（云厂商、容器编排、数据库、缓存等）
2. 网络架构（VPC、子网、安全组、负载均衡）
3. 计算资源规划（节点规格、自动伸缩策略）
4. 存储方案（持久化存储、对象存储）
5. IaC 代码框架建议（Terraform/Pulumi 结构）
6. 成本估算""",
            expected_output="""完整的基础设施设计文档，
可直接作为 Terraform/IaC 实现的蓝本。""",
            agent=self.infra_engineer(),
            output_file="output/devops_infra.md",
        )

    def cicd_task(self) -> Task:
        """CI/CD 管道设计任务"""
        return Task(
            description="""设计完整的 CI/CD 管道：
1. CI 阶段：代码检查 → 构建 → 单元测试 → 安全扫描 → 制品打包
2. CD 阶段：构建推送 → 环境部署（Dev → Staging → Prod）→ 冒烟测试
3. 部署策略建议（滚动/蓝绿/金丝雀）
4. 回滚机制
5. 环境变量和密钥管理
6. Pipeline as Code 示例（GitHub Actions/YAML）""",
            expected_output="""可执行的 CI/CD 配置文件和流程说明。""",
            agent=self.cicd_engineer(),
            context=[self.infra_task()],
            output_file="output/devops_cicd.md",
        )

    def security_task(self) -> Task:
        """安全加固任务"""
        return Task(
            description="""进行 DevSecOps 安全加固设计：
1. SAST/DAST 工具集成方案
2. 容器安全镜像扫描
3. 密钥和证书管理方案（Vault 集成）
4. 网络安全策略（最小权限原则）
5. 合规检查清单（GDPR/ISO27001 等）
6. 安全事件响应流程""",
            expected_output="""DevSecOps 实施计划，包含工具选型、
配置示例和合规清单。""",
            agent=self.security_engineer(),
            context=[self.infra_task(), self.cicd_task()],
            output_file="output/devops_security.md",
        )

    def observability_task(self) -> Task:
        """可观测性体系设计任务"""
        return Task(
            description="""建立完整的可观测性体系：
1. 监控指标设计（四大黄金信号：延迟/流量/错误/饱和度）
2. 日志采集和分析方案
3. 分布式追踪集成
4. 关键告警规则（分级：P0-P4）
5. SLO/SLA 定义
6. 仪表盘和 Runbook 设计
7. On-call 响应流程""",
            expected_output="""完整的可观测性实施计划，
包含监控配置、告警规则和 Runbook 模板。""",
            agent=self.sre(),
            context=[self.infra_task()],
            output_file="output/devops_observability.md",
        )

    # ========== Crew ==========
    def build_crew(self, **kwargs) -> Crew:
        """构建 DevOps 团队"""
        ensure_output_dir()
        return Crew(
            agents=[
                self.infra_engineer(),
                self.cicd_engineer(),
                self.security_engineer(),
                self.sre(),
            ],
            tasks=[
                self.infra_task(),
                self.cicd_task(),
                self.security_task(),
                self.observability_task(),
            ],
            process=Process.sequential,
            verbose=self.verbose,
            llm=self.llm,        )


def quick_devops(application: str, verbose: bool = True):
    """快速生成 DevOps 方案"""
    crew = DevOpsCrew(verbose=verbose)
    return crew.run({"application": application})
