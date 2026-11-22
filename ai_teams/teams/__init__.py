"""
AI Teams - 多团队协作系统
"""

from .config import get_llm, get_default_llm, reset_default_llm, diagnose
from .base import BaseTeam, ensure_output_dir

from .dev_crew import DevCrew
from .data_crew import DataCrew
from .content_crew import ContentCrew
from .research_crew import ResearchCrew
from .pm_crew import PMCrew
from .devops_crew import DevOpsCrew
from .design_crew import DesignCrew

__all__ = [
    # 配置
    "get_llm",
    "get_default_llm",
    "reset_default_llm",
    "diagnose",
    "BaseTeam",
    "ensure_output_dir",
    # 7 个团队
    "DevCrew",
    "DataCrew",
    "ContentCrew",
    "ResearchCrew",
    "PMCrew",
    "DevOpsCrew",
    "DesignCrew",
    "TEAM_REGISTRY",
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
