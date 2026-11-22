#!/usr/bin/env python3
"""
构建验证测试 - 验证 7 个 Team 都能正确组装
不调用真实 LLM，只验证对象构建和依赖关系
"""
import sys
import os

# 加载 .env
from dotenv import load_dotenv
load_dotenv()

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from teams import (
    DevCrew, DataCrew, ContentCrew, ResearchCrew,
    PMCrew, DevOpsCrew, DesignCrew, TEAM_REGISTRY,
    diagnose,
)


def test_team_build(team_class, name: str):
    """测试单个 Team 的构建"""
    print(f"\n🔧 测试 {name}...")
    try:
        team = team_class(verbose=False)
        crew = team.build_crew()

        agents = crew.agents
        tasks = crew.tasks
        print(f"  ✅ Agent 数: {len(agents)}")
        print(f"  ✅ Task 数: {len(tasks)}")
        print(f"  ✅ Process: {crew.process}")

        for i, agent in enumerate(agents):
            print(f"     Agent[{i}]: {agent.role}")
        for i, task in enumerate(tasks):
            print(f"     Task[{i}]: {task.description[:60]}...")

        return True
    except Exception as e:
        print(f"  ❌ 构建失败: {e}")
        import traceback
        traceback.print_exc()
        return False


def main():
    print("\n" + "=" * 60)
    print("🏗️  AI Teams 构建验证测试")
    print("=" * 60)

    # 1. LLM 配置诊断
    print("\n📋 步骤 1: LLM 配置诊断")
    print("-" * 60)
    diagnose()

    # 2. 逐个测试 Team 构建
    print("\n📋 步骤 2: Team 构建测试")
    print("-" * 60)

    results = {}
    for key, cls in TEAM_REGISTRY.items():
        ok = test_team_build(cls, f"{cls.TEAM_NAME} ({key})")
        results[key] = ok

    # 3. 汇总
    print("\n📋 步骤 3: 汇总")
    print("-" * 60)
    passed = sum(1 for v in results.values() if v)
    total = len(results)
    print(f"\n  通过: {passed}/{total}")

    if passed == total:
        print("\n  🎉 所有 Team 构建成功!")
        print("  💡 下一步: 配置 API Key 后运行 'python main.py run <team> --input ...'")
    else:
        failed = [k for k, v in results.items() if not v]
        print(f"\n  ❌ 失败: {failed}")
        sys.exit(1)


if __name__ == "__main__":
    main()
