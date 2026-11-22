"""
基础 Crew 类 - 所有 AI 团队的基类
提供通用的配置和运行方法
"""
import os
from abc import ABC, abstractmethod
from typing import Any, Dict, Optional


class BaseTeam(ABC):
    """所有 AI 团队的基类"""

    # 团队元信息（子类必须重写）
    TEAM_NAME: str = "BaseTeam"
    TEAM_DESC: str = "基础团队"
    TEAM_VERSION: str = "1.0.0"

    def __init__(self, verbose: bool = True, memory: bool = False):
        self.verbose = verbose
        self.memory = memory
        self._crew = None

    @abstractmethod
    def build_crew(self, **kwargs) -> Any:
        """构建 CrewAI Crew 实例（子类必须实现）"""
        ...

    def run(self, inputs: Optional[Dict[str, Any]] = None, **kwargs) -> Any:
        """运行团队"""
        if self._crew is None:
            self._crew = self.build_crew(**kwargs)

        if inputs is None:
            inputs = {}

        if self.verbose:
            print(f"\n{'='*60}")
            print(f"🚀 启动团队: {self.TEAM_NAME}")
            print(f"📋 描述: {self.TEAM_DESC}")
            print(f"📥 输入参数: {list(inputs.keys()) if inputs else '无'}")
            print(f"{'='*60}\n")

        result = self._crew.kickoff(inputs=inputs)

        if self.verbose:
            print(f"\n{'='*60}")
            print(f"✅ 团队 {self.TEAM_NAME} 完成任务")
            print(f"{'='*60}\n")

        return result

    def run_async(self, inputs: Optional[Dict[str, Any]] = None, **kwargs) -> Any:
        """异步运行团队"""
        if self._crew is None:
            self._crew = self.build_crew(**kwargs)

        if inputs is None:
            inputs = {}

        return self._crew.kickoff_async(inputs=inputs)

    @property
    def crew(self) -> Any:
        """获取 Crew 实例（延迟构建）"""
        if self._crew is None:
            self._crew = self.build_crew()
        return self._crew

    def __repr__(self) -> str:
        return f"<{self.TEAM_NAME} v{self.TEAM_VERSION}: {self.TEAM_DESC}>"


def ensure_output_dir(path: str = "output") -> str:
    """确保输出目录存在"""
    os.makedirs(path, exist_ok=True)
    return path
