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
        "default_model": "qwen2.5:3b",
        "default_full": "ollama/qwen2.5:3b",
    },
}


def _detect_provider() -> Optional[str]:
    """
    检测可用的 provider（按优先级）
    优先级: 显式 LLM_PROVIDER > OLLAMA(本地) > DEEPSEEK > OPENAI > ANTHROPIC > GOOGLE > GROQ
    """
    # 显式指定优先（最最高）
    explicit = os.getenv("LLM_PROVIDER")
    if explicit and explicit in PROVIDERS:
        return explicit

    # Ollama 本地：如果设了 OLLAMA_BASE_URL 就算有
    ollama_url = os.getenv("OLLAMA_BASE_URL")
    if ollama_url:
        return "ollama"

    # 按优先级检测有 API Key 的云 provider
    priority = ["deepseek", "openai", "anthropic", "google", "groq"]
    for p in priority:
        cfg = PROVIDERS[p]
        api_key = os.getenv(cfg["api_key_env"]) if cfg["api_key_env"] else None
        if api_key:
            return p
    return None


def get_llm(model: Optional[str] = None, temperature: float = 0.7,
            timeout: float = 600, **kwargs):
    """
    创建 CrewAI LLM 实例

    Args:
        model: 模型名，格式 "provider/model" 或简写 "model-id"
               不传则使用 LLM_MODEL 环境变量或 provider 的默认模型
        temperature: 随机性 (0.0-1.0)，低=确定性，高=创造性
        timeout: 超时秒数
        **kwargs: LLM 其他参数（max_tokens, top_p 等）

    Returns:
        crewai.LLM 实例；若无法配置则返回 None
    """
    # 优先顺序: 函数参数 model > 环境变量 LLM_MODEL > provider 默认
    if not model:
        env_model = os.getenv("LLM_MODEL")
        if env_model:
            model = env_model

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

    # 确定最终模型全名（CrewAI 新版全部需要 provider 前缀）
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

    # Ollama 特殊处理：base_url 自动加 /v1 (CrewAI 通过 OpenAI 兼容协议调 Ollama)
    if provider == "ollama":
        base_url = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
        if not base_url.endswith("/v1"):
            base_url = base_url.rstrip("/") + "/v1"
        llm_kwargs["base_url"] = base_url
    elif cfg["base_url_env"]:
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


# ============ Token 价格表（人民币 ¥ / 1M tokens）============
# 数据来源：各官方定价页面，2026-11-22 采集
# 单位：输入 token 价格 / 输出 token 价格
PRICING = {
    # provider: {model_prefix: (输入价, 输出价)}
    "deepseek": {
        "default": (1.0, 2.0),            # deepseek-chat / deepseek-v3
        "deepseek-chat": (1.0, 2.0),
        "deepseek-reasoner": (2.0, 8.0),
    },
    "openai": {
        "default": (4.0, 16.0),
        "gpt-4o": (5.0, 15.0),
        "gpt-4o-mini": (0.15, 0.60),
        "gpt-4.1": (10.0, 40.0),
    },
    "anthropic": {
        "default": (15.0, 75.0),
        "claude-3-5-sonnet": (3.0, 15.0),
        "claude-3.5-sonnet": (3.0, 15.0),
        "claude-3-opus": (15.0, 75.0),
    },
    "google": {
        "default": (1.5, 6.0),
        "gemini-2.0-flash": (0.75, 3.0),
        "gemini-2.5-pro": (1.5, 6.0),
    },
    "groq": {
        "default": (0.6, 1.2),             # llama-3.3-70b
    },
    "ollama": {
        "default": (0.0, 0.0),             # 本地模型免费
    },
}


def _get_llm_provider_and_model(llm) -> tuple:
    """从 LLM 实例提取 (provider, model_name)"""
    if llm is None:
        return ("unknown", "unknown")
    model_str = getattr(llm, "model", "") or ""
    if "/" in model_str:
        provider, model = model_str.split("/", 1)
        return (provider, model)
    # 某些 provider 不带前缀
    provider = _detect_provider() or "unknown"
    return (provider, model_str)


def estimate_cost(input_tokens: int, output_tokens: int, llm=None,
                  provider: str = None, model: str = None) -> float:
    """
    根据 token 用量估算费用（人民币）

    Args:
        input_tokens: 输入 token 数
        output_tokens: 输出 token 数
        llm: crewai.LLM 实例（优先从这里推断）
        provider: provider 名（llm 为 None 时使用）
        model: 模型名（llm 为 None 时使用）

    Returns:
        预估费用（元），无法估算时返回 None
    """
    if llm is not None:
        provider, model = _get_llm_provider_and_model(llm)
    if provider is None:
        provider = _detect_provider() or "unknown"

    provider_pricing = PRICING.get(provider)
    if not provider_pricing:
        return None

    # 精确匹配模型 → 回退 default
    input_price, output_price = provider_pricing.get(
        model, provider_pricing.get("default", (None, None))
    )
    if input_price is None:
        return None

    cost = (input_tokens / 1_000_000) * input_price + \
           (output_tokens / 1_000_000) * output_price
    return round(cost, 4)


def estimate_team_cost(num_tasks: int = 4, avg_input_per_task: int = 12000,
                       avg_output_per_task: int = 2500, llm=None,
                       provider: str = None, model: str = None) -> dict:
    """
    估算一个 Team 的预期成本

    Args:
        num_tasks: Task 数量（默认 4）
        avg_input_per_task: 每个 Task 平均输入 token（默认 12K）
        avg_output_per_task: 每个 Task 平均输出 token（默认 2.5K）
        llm/provider/model: 用于定价

    Returns:
        dict {
            input_tokens, output_tokens, total_tokens,
            cost_yuan, provider, model,
            note: 说明（如含缓存折扣、不含推理 token）
        }
    """
    total_input = num_tasks * avg_input_per_task
    total_output = num_tasks * avg_output_per_task
    cost = estimate_cost(total_input, total_output, llm=llm,
                         provider=provider, model=model)
    p, m = _get_llm_provider_and_model(llm) if llm else (
        provider or _detect_provider() or "unknown", model or "default")

    note = "估算值，实际可能 ±50%。含上下文累积、不含缓存命中折扣。"
    return {
        "input_tokens": total_input,
        "output_tokens": total_output,
        "total_tokens": total_input + total_output,
        "cost_yuan": cost,
        "provider": p,
        "model": m,
        "note": note,
    }


def format_usage(metrics) -> str:
    """
    格式化 UsageMetrics 为易读字符串

    Args:
        metrics: UsageMetrics 对象（crew.usage_metrics）

    Returns:
        格式化字符串
    """
    if metrics is None:
        return "(无用量数据)"

    total = getattr(metrics, "total_tokens", 0) or 0
    prompt = getattr(metrics, "prompt_tokens", 0) or 0
    completion = getattr(metrics, "completion_tokens", 0) or 0
    cached = getattr(metrics, "cached_prompt_tokens", 0) or 0
    reasoning = getattr(metrics, "reasoning_tokens", 0) or 0
    requests = getattr(metrics, "successful_requests", 0) or 0

    lines = [
        f"  📊 Token 用量统计:",
        f"     总计: {total:,} tokens",
        f"       ├─ 输入: {prompt:,}",
        f"       ├─ 输出: {completion:,}",
    ]
    if cached:
        lines.append(f"       ├─ 缓存命中: {cached:,} (省了约 ¥{(cached/1_000_000)*4:.3f})")
    if reasoning:
        lines.append(f"       └─ 推理: {reasoning:,}")
    lines.append(f"     成功请求: {requests} 次")
    return "\n".join(lines)


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
        status = "✅ 已配置" if has_key else "❌ 未配置"
        # 附加价格
        p = PRICING.get(name, {})
        price = p.get("default", (None, None))
        if price[0] is not None:
            status += f"  (¥{price[0]}/¥{price[1]} per 1M)"
        print(f"  {name:12s}: {status}")

    # 3. 测试 LLM 创建
    print("\n  正在创建 LLM 实例...")
    llm = get_llm()
    if llm:
        provider, model = _get_llm_provider_and_model(llm)
        est = estimate_team_cost(num_tasks=4, llm=llm)
        print(f"  ✅ LLM 创建成功: {provider}/{model}")
        print(f"  💰 预估 4-task Team 成本: ~¥{est['cost_yuan']:.2f} "
              f"(总 {est['total_tokens']:,} tokens)")
    else:
        print("  ❌ LLM 创建失败：未检测到任何有效的 API Key")
        print("  💡 请在 .env 中设置 DEEPSEEK_API_KEY / OPENAI_API_KEY 等")

    print("=" * 50 + "\n")
    return llm is not None
