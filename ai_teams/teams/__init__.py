"""
AI Teams - 多团队协作系统
包含 7 个专业 AI 团队：
1. DevCrew - 软件开发团队
2. DataCrew - 数据分析团队
3. ContentCrew - 内容创作团队
4. ResearchCrew - 研究调查团队
5. PMCrew - 项目管理团队
6. DevOpsCrew - DevOps 团队
7. DesignCrew - 产品设计团队
"""

from .dev_crew import DevCrew
from .data_crew import DataCrew
from .content_crew import ContentCrew
from .research_crew import ResearchCrew
from .pm_crew import PMCrew
from .devops_crew import DevOpsCrew
from .design_crew import DesignCrew

__all__ = [
    "DevCrew",
    "DataCrew",
    "ContentCrew",
    "ResearchCrew",
    "PMCrew",
    "DevOpsCrew",
    "DesignCrew",
]

TEAM_REGISTRY = {
    "dev": DevCrew,
    "data": DataCrew,
    "content": ContentCrew,
    "research": ResearchCrew,
    "pm": PMCrew,
    "devops": DevOpsCrew,
    "design": DesignCrew,
}
