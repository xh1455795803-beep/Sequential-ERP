#!/usr/bin/env python3
"""
安装脚本 - 一键安装 AI Teams 系统依赖
"""
import subprocess
import sys
import os


def check_python():
    """检查 Python 版本"""
    version = sys.version_info
    if version < (3, 9):
        print(f"❌ 需要 Python 3.9+, 当前版本: {version.major}.{version.minor}")
        sys.exit(1)
    print(f"✅ Python {version.major}.{version.minor} OK")


def install_deps():
    """安装依赖"""
    print("\n📦 正在安装依赖...")
    try:
        subprocess.check_call([
            sys.executable, "-m", "pip", "install",
            "-r", "requirements.txt",
            "-q",
        ])
        print("✅ 依赖安装完成")
    except subprocess.CalledProcessError as e:
        print(f"❌ 依赖安装失败: {e}")
        sys.exit(1)


def create_env():
    """创建 .env 文件"""
    env_path = ".env"
    if os.path.exists(env_path):
        print(f"✅ {env_path} 已存在")
        return

    example_path = ".env.example"
    if os.path.exists(example_path):
        import shutil
        shutil.copy(example_path, env_path)
        print(f"✅ 已从 {example_path} 创建 {env_path}")
        print("   请编辑 .env 文件，填入你的 API Key")
    else:
        print(f"⚠️  未找到 {example_path}，跳过 .env 创建")


def verify_installation():
    """验证安装"""
    print("\n🔍 验证安装...")
    try:
        from teams import TEAM_REGISTRY
        print(f"✅ 成功导入 {len(TEAM_REGISTRY)} 个团队:")
        for key in TEAM_REGISTRY:
            cls = TEAM_REGISTRY[key]
            print(f"   - {cls.TEAM_NAME}: {cls.TEAM_DESC}")
    except ImportError as e:
        print(f"❌ 导入失败: {e}")
        sys.exit(1)


def main():
    print("=" * 50)
    print("🤖 AI Teams 系统安装")
    print("=" * 50)

    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    check_python()
    install_deps()
    create_env()
    verify_installation()

    print("\n" + "=" * 50)
    print("🎉 安装完成!")
    print("=" * 50)
    print("\n下一步:")
    print("  1. 编辑 .env 文件，填入 API Key")
    print("  2. 运行 'python main.py list' 查看所有团队")
    print("  3. 运行 'python main.py demo' 查看示例命令")


if __name__ == "__main__":
    main()
