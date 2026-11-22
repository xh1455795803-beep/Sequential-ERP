#!/usr/bin/env python3
"""
AI Teams - 多团队协作系统 统一入口
====================================

快速示例:
    python main.py run dev --input "用 Python 写一个待办事项应用"
    python main.py run data --input "分析 2024 年电商销售数据趋势"
    python main.py run content --input "AI 在医疗领域的应用" --extra target_words=2000
    python main.py list
    python main.py demo
"""

import argparse
import json
import os
import sys

# 加载 .env
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from teams import (
    DevCrew,
    DataCrew,
    ContentCrew,
    ResearchCrew,
    PMCrew,
    DevOpsCrew,
    DesignCrew,
    TEAM_REGISTRY,
)
from teams.config import (
    get_llm,
    estimate_cost,
    estimate_team_cost,
    format_usage,
    _get_llm_provider_and_model,
)

# ========== 团队信息 ==========
TEAM_INFO = {
    "dev": {
        "name": "DevCrew",
        "desc": "软件开发团队",
        "usage": "--input <需求描述>",
        "input_key": "project_requirement",
        "example": "用 Python FastAPI 写一个用户认证 API",
    },
    "data": {
        "name": "DataCrew",
        "desc": "数据分析团队",
        "usage": "--input <分析主题>",
        "input_key": "analysis_topic",
        "example": "分析共享单车城市骑行数据",
    },
    "content": {
        "name": "ContentCrew",
        "desc": "内容创作团队",
        "usage": "--input <内容主题> [--extra target_words=1500]",
        "input_key": "content_topic",
        "example": "人工智能在教育中的应用",
    },
    "research": {
        "name": "ResearchCrew",
        "desc": "研究调查团队",
        "usage": "--input <研究主题>",
        "input_key": "research_topic",
        "example": "2025 年全球可再生能源发展现状",
    },
    "pm": {
        "name": "PMCrew",
        "desc": "项目管理团队",
        "usage": "--input <项目目标>",
        "input_key": "project_goal",
        "example": "开发一个移动端健身追踪应用",
    },
    "devops": {
        "name": "DevOpsCrew",
        "desc": "DevOps 团队",
        "usage": "--input <应用名称/描述>",
        "input_key": "application",
        "example": "为一个 Spring Boot 微服务应用设计部署架构",
    },
    "design": {
        "name": "DesignCrew",
        "desc": "产品设计团队",
        "usage": "--input <产品概念>",
        "input_key": "product_concept",
        "example": "一款面向老年人的简化版社交媒体 App",
    },
}


def cmd_list(args):
    """列出所有可用团队"""
    print("\n" + "=" * 60)
    print("🤖 可用 AI 团队")
    print("=" * 60)
    for key, info in TEAM_INFO.items():
        print(f"\n  [{key}] {info['name']}")
        print(f"    描述: {info['desc']}")
        print(f"    用法: python main.py run {key} {info['usage']}")
        print(f"    示例: {info['example']}")
    print("\n" + "=" * 60)


def cmd_run(args):
    """运行指定团队"""
    team_key = args.team
    if team_key not in TEAM_REGISTRY:
        print(f"❌ 未知团队: {team_key}")
        print(f"   运行 'python main.py list' 查看所有可用团队")
        sys.exit(1)

    # 1) 构建输入
    info = TEAM_INFO[team_key]
    inputs = {}

    if args.input:
        inputs[info["input_key"]] = args.input
    elif args.input_file:
        with open(args.input_file, "r", encoding="utf-8") as f:
            inputs[info["input_key"]] = f.read()
    else:
        print(f"❌ 需要 --input 或 --input-file")
        print(f"   示例: python main.py run {team_key} --input \"{info['example']}\"")
        sys.exit(1)

    if args.extra:
        for pair in args.extra:
            if "=" in pair:
                k, v = pair.split("=", 1)
                inputs[k] = v

    # 2) 检查 LLM
    llm = get_llm()
    if llm is None:
        print("\n❌ 未检测到 LLM API Key")
        print("   请在 .env 中设置 DEEPSEEK_API_KEY / OPENAI_API_KEY 等")
        print("   或运行 'python main.py list' → 先去服务商注册")
        sys.exit(1)

    # 3) 成本预估
    team_class = TEAM_REGISTRY[team_key]
    team_temp = team_class(verbose=False)
    num_tasks = len(team_temp.build_crew().tasks)
    del team_temp

    est = estimate_team_cost(num_tasks=num_tasks, llm=llm)
    provider, model = _get_llm_provider_and_model(llm)

    # 估算：实际 cost 以 crew.usage_metrics 为准，但先给个预估值
    print(f"\n{'='*60}")
    print(f"📋 任务预估")
    print(f"{'='*60}")
    print(f"  团队: {info['name']}")
    print(f"  任务数: {num_tasks}")
    print(f"  LLM: {provider}/{model}")
    print(f"  预估 token: ~{est['total_tokens']:,} "
          f"(输入 ~{est['input_tokens']:,}, 输出 ~{est['output_tokens']:,})")
    if est["cost_yuan"] is not None:
        print(f"  预估费用: ~¥{est['cost_yuan']:.2f}")
    else:
        print(f"  预估费用: (该 provider 价格未收录)")
    print(f"  ⚠️  {est['note']}")

    # 4) 确认（--yes / -y 跳过）
    if not getattr(args, "yes", False):
        print(f"\n  继续? (y/N): ", end="", flush=True)
        try:
            ans = input().strip().lower()
        except (EOFError, KeyboardInterrupt):
            ans = "n"
        if ans not in ("y", "yes"):
            print("  已取消")
            sys.exit(0)

    # 5) 运行
    print(f"\n{'='*60}")
    print(f"🚀 启动 {info['name']}...")
    print(f"{'='*60}\n")

    team = team_class(verbose=not args.quiet)

    try:
        result = team.run(inputs=inputs)
    except Exception as e:
        print(f"\n❌ 运行出错: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

    # 6) 显示实际用量和费用
    print(f"\n{'='*60}")
    print(f"✅ 完成!")
    print(f"{'='*60}")

    metrics = team._crew.usage_metrics if team._crew else None
    print(format_usage(metrics))

    if metrics is not None:
        total = getattr(metrics, "total_tokens", 0) or 0
        prompt = getattr(metrics, "prompt_tokens", 0) or 0
        completion = getattr(metrics, "completion_tokens", 0) or 0
        actual_cost = estimate_cost(prompt, completion, llm=llm)
        if actual_cost is not None:
            print(f"\n  💰 本次实际费用: ¥{actual_cost:.4f}")

    print(f"\n📁 结果已保存到 output/ 目录")
    if hasattr(result, "raw"):
        raw = result.raw or ""
        if raw:
            preview = raw[:600] + "..." if len(raw) > 600 else raw
            print(f"\n📄 最终输出预览:\n")
            print(preview)
    print()


def cmd_demo(args):
    """演示模式 - 展示所有团队"""
    print("\n" + "=" * 60)
    print("🎬 AI Teams 快速演示")
    print("=" * 60)
    print("\n可用的团队和快速示例命令：")
    print("\n  1️⃣  DevCrew (软件开发)")
    print("     python main.py run dev --input '用 Python 写一个 CLI 待办事项'")
    print("\n  2️⃣  DataCrew (数据分析)")
    print("     python main.py run data --input '某公司 Q1 销售数据分析'")
    print("\n  3️⃣  ContentCrew (内容创作)")
    print("     python main.py run content --input '远程办公的利弊' --extra target_words=2000")
    print("\n  4️⃣  ResearchCrew (研究调查)")
    print("     python main.py run research --input '2025 AI 大模型发展现状'")
    print("\n  5️⃣  PMCrew (项目管理)")
    print("     python main.py run pm --input '开发一个在线教育平台'")
    print("\n  6️⃣  DevOpsCrew (DevOps)")
    print("     python main.py run devops --input 'React + Node.js 全栈应用部署'")
    print("\n  7️⃣  DesignCrew (产品设计)")
    print("     python main.py run design --input '面向学生的刷题学习 App'")
    print("\n" + "=" * 60)


def main():
    parser = argparse.ArgumentParser(
        description="🤖 AI Teams - 多团队协作系统",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python main.py list                              列出所有团队
  python main.py run dev --input "你的需求"         运行开发团队
  python main.py run data --input "分析主题"         运行数据团队
  python main.py run content --input "主题" --extra target_words=2000
  python main.py demo                               演示模式
        """,
    )

    subparsers = parser.add_subparsers(dest="command", help="子命令")

    # list 子命令
    subparsers.add_parser("list", help="列出所有可用团队")

    # run 子命令
    run_parser = subparsers.add_parser("run", help="运行指定团队")
    run_parser.add_argument("team", choices=list(TEAM_REGISTRY.keys()), help="团队名称")
    run_parser.add_argument("--input", "-i", help="直接输入内容")
    run_parser.add_argument("--input-file", "-f", help="从文件读取输入")
    run_parser.add_argument("--extra", "-e", action="append", help="额外参数 key=value")
    run_parser.add_argument("--quiet", "-q", action="store_true", help="静默模式")
    run_parser.add_argument("--yes", "-y", action="store_true", help="跳过成本确认直接运行")

    # demo 子命令
    subparsers.add_parser("demo", help="演示模式")

    args = parser.parse_args()

    if args.command == "list":
        cmd_list(args)
    elif args.command == "run":
        args.verbose = not getattr(args, "quiet", False)
        cmd_run(args)
    elif args.command == "demo":
        cmd_demo(args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
