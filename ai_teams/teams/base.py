"""
基础 Crew 类 - 所有 AI 团队的基类
提供通用的配置、LLM 注入和运行方法
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

    def __init__(
        self,
        verbose: bool = True,
        memory: bool = False,
        llm: Any = None,
        llm_config: Optional[Dict[str, Any]] = None,
    ):
        """
        Args:
            verbose: 是否打印详细日志
            memory: 是否启用 Crew 记忆功能
            llm: 直接注入 LLM 实例（crewai.LLM）
            llm_config: 从 config.py 创建 LLM 的参数
                        如 {"model": "deepseek/deepseek-chat", "temperature": 0.5}
        """
        self.verbose = verbose
        self.memory = memory
        self._crew = None

        # 解析 LLM
        self._llm = None
        if llm is not None:
            self._llm = llm
        elif llm_config is not None:
            from .config import get_llm
            self._llm = get_llm(**llm_config)
        else:
            from .config import get_default_llm
            self._llm = get_default_llm()

    def _agent_kwargs(self, **defaults) -> Dict[str, Any]:
        """构建 Agent 的 kwargs，注入 LLM（如果可用）"""
        kwargs = dict(defaults)
        if self._llm is not None:
            kwargs["llm"] = self._llm
        return kwargs

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
            llm_info = f"{self._llm.model}" if self._llm else "(未配置)"
            print(f"\n{'='*60}")
            print(f"🚀 启动团队: {self.TEAM_NAME}")
            print(f"📋 描述: {self.TEAM_DESC}")
            print(f"🧠 LLM: {llm_info}")
            print(f"📥 输入: {list(inputs.keys()) if inputs else '无'}")
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

    @property
    def llm(self) -> Any:
        """获取当前使用的 LLM"""
        return self._llm

    def __repr__(self) -> str:
        llm_info = f", llm={self._llm.model}" if self._llm else ""
        return f"<{self.TEAM_NAME} v{self.TEAM_VERSION}{llm_info}: {self.TEAM_DESC}>"


def ensure_output_dir(path: str = "output") -> str:
    """确保输出目录存在"""
    os.makedirs(path, exist_ok=True)
    return path
