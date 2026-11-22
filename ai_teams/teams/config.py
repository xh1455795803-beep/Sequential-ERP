"""
统一 LLM 配置模块
=================

设计原则（来自历史经验）：
1. **环境变量优先** - 密钥不硬编码，配置走 .env
2. **Provider 显式映射** - 避免模型名不匹配导致 400 错误
3. **单一开关** - 通过 MODEL 或 LLM_PROVIDER 切换提供商
4. **能力回退** - provider 不支持的模型自动映射到默认模型

用法:
    from teams.config import get_llm, DEFAULT_LLM

    # 使用默认
    llm = DEFAULT_LLM

    # 指定模型
    llm = get_llm("openai/gpt-4o")

    # 每个团队统一用这个函数获取 LLM
"""
import os
from typing import Optional


# ============ Provider 注册表 ============
# 支持的 provider、对应的环境变量名、默认模型
PROVIDERS = {
    # 原生集成（无需额外依赖）
    "openai": {
        "api_key_env": "OPENAI_API_KEY",
        "base_url_env": "OPENAI_BASE_URL",
        "default_model": "gpt-4o-mini",
        "default_full": "openai/gpt-4o-mini",
    },
    "anthropic": {
        "api_key_env": "ANTHROPIC_API_KEY",
        "base_url_env": None,
        "default_model": "claude-3-5-sonnet-20241022",
        "default_full": "anthropic/claude-3-5-sonnet-20241022",
    },
    "google": {
        "api_key_env": "GOOGLE_API_KEY",
        "base_url_env": None,
        "default_model": "gemini-2.0-flash-exp",
        "default_full": "google/gemini-2.0-flash-exp",
    },
    # LiteLLM 覆盖（需 crewai[litellm]）
    "deepseek": {
        "api_key_env": "DEEPSEEK_API_KEY",
        "base_url_env": None,
        "default_model": "deepseek-chat",
        "default_full": "deepseek/deepseek-chat",
    },
    "groq": {
        "api_key_env": "GROQ_API_KEY",
        "base_url_env": None,
        "default_model": "llama-3.3-70b-versatile",
        "default_full": "groq/llama-3.3-70b-versatile",
    },
    # 本地/自建（如 Ollama）
    "ollama": {
        "api_key_env": None,
        "base_url_env": "OLLAMA_BASE_URL",
        "default_model": "qwen2.5:7b",
        "default_full": "ollama/qwen2.5:7b",
    },
}


def _detect_provider() -> Optional[str]:
    """
    检测可用的 provider（按优先级）
    优先级: DEEPSEEK > OPENAI > ANTHROPIC > GOOGLE > GROQ
    """
    # 显式指定优先
    explicit = os.getenv("LLM_PROVIDER")
    if explicit and explicit in PROVIDERS:
        return explicit

    # 按优先级检测
    priority = ["deepseek", "openai", "anthropic", "google", "groq"]
    for p in priority:
        cfg = PROVIDERS[p]
        api_key = os.getenv(cfg["api_key_env"]) if cfg["api_key_env"] else None
        if api_key:
            return p
    return None


def get_llm(model: Optional[str] = None, temperature: float = 0.7,
            timeout: float = 120, **kwargs):
    """
    创建 CrewAI LLM 实例

    Args:
        model: 模型名，格式 "provider/model" 或简写 "model-id"
               不传则使用 provider 的默认模型
        temperature: 随机性 (0.0-1.0)，低=确定性，高=创造性
        timeout: 超时秒数
        **kwargs: LLM 其他参数（max_tokens, top_p 等）

    Returns:
        crewai.LLM 实例；若无法配置则返回 None
    """
    provider = _detect_provider()

    # 如果显式指定了 provider/model，用它
    if model:
        if "/" in model:
            provider_name, model_name = model.split("/", 1)
            if provider_name in PROVIDERS:
                provider = provider_name
        # 没有 provider 前缀，用默认 provider
        if not provider and "/" not in model:
            provider = "openai"  # 保底

    if not provider:
        # 没有任何 API Key 配置，返回 None（让调用方处理）
        return None

    cfg = PROVIDERS[provider]

    # 确定最终模型全名
    if model and "/" in model:
        full_model = model
    elif model:
        full_model = f"{provider}/{model}"
    else:
        full_model = cfg["default_full"]

    # 延迟导入，避免没有 crewai 时报错
    try:
        from crewai import LLM
    except ImportError:
        print(f"⚠️  crewai 未安装，无法创建 LLM 实例")
        return None

    llm_kwargs = {"model": full_model, "temperature": temperature, "timeout": timeout}
    llm_kwargs.update(kwargs)

    # 如果有 base_url，加进去
    if cfg["base_url_env"]:
        base_url = os.getenv(cfg["base_url_env"])
        if base_url:
            llm_kwargs["base_url"] = base_url

    return LLM(**llm_kwargs)


# 默认 LLM 实例（延迟创建）
_DEFAULT_LLM = None


def get_default_llm():
    """获取默认 LLM（全局单例）"""
    global _DEFAULT_LLM
    if _DEFAULT_LLM is None:
        _DEFAULT_LLM = get_llm()
    return _DEFAULT_LLM


def reset_default_llm():
    """重置默认 LLM（用于切换模型后）"""
    global _DEFAULT_LLM
    _DEFAULT_LLM = None


def diagnose():
    """
    诊断 LLM 配置状态（用于排查问题）
    """
    print("\n🔍 LLM 配置诊断")
    print("=" * 50)

    # 1. 检测 provider
    provider = _detect_provider()
    print(f"  检测到的 Provider: {provider or '(无 - 未配置任何 API Key)'}")

    # 2. 逐个检查
    for name, cfg in PROVIDERS.items():
        has_key = False
        if cfg["api_key_env"]:
            key = os.getenv(cfg["api_key_env"])
            has_key = bool(key)
        print(f"  {name:12s}: {'✅ 已配置' if has_key else '❌ 未配置'} "
              f"(默认模型: {cfg['default_full']})")

    # 3. 测试 LLM 创建
    print("\n  正在创建 LLM 实例...")
    llm = get_llm()
    if llm:
        print(f"  ✅ LLM 创建成功: {llm}")
    else:
        print("  ❌ LLM 创建失败：未检测到任何有效的 API Key")
        print("  💡 请在 .env 中设置 OPENAI_API_KEY / DEEPSEEK_API_KEY 等")

    print("=" * 50 + "\n")
    return llm is not None
