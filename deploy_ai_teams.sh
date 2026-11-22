#!/bin/bash
# ============================================================
# AI Teams 一键部署脚本
# 服务器：腾讯云 124.222.96.218 (上海)
# 模型：qwen2.5:3b (Ollama 本地，完全免费)
# ============================================================
set -e

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║          🚀 AI Teams 一键部署脚本 v1.0                  ║"
echo "║   7个专业AI团队 · CrewAI + Ollama · 完全免费             ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# ── 颜色 ──────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'
ok() { echo -e "${GREEN}✅ $1${NC}"; }
info() { echo -e "${CYAN}🔧 $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }
err() { echo -e "${RED}❌ $1${NC}"; exit 1; }

# ── 第1步：系统检查 ─────────────────────────────────
echo -e "${CYAN}━━━ [1/6] 系统检查 ━━━${NC}"
cd ~
echo "系统: $(cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2 | tr -d '"')"
echo "CPU核数: $(nproc)"
echo "内存: $(free -h | awk '/Mem:/ {print $2}')"
echo "磁盘: $(df -h / | awk '/\// {print $4}') 可用"
ok "环境 OK"

# ── 第2步：装基础依赖 ──────────────────────────────
echo -e "\n${CYAN}━━━ [2/6] 装基础依赖 ━━━${NC}"
if [ -f /etc/debian_version ]; then
    apt-get update -qq && apt-get install -y -qq curl python3 python3-pip python3-venv tar 2>/dev/null || true
elif [ -f /etc/centos-release ] || [ -f /etc/redhat-release ]; then
    yum install -y curl python3 python3-pip tar 2>/dev/null || true
fi
python3 --version && pip3 --version
ok "Python + pip OK"

# ── 第3步：装 Ollama ────────────────────────────────
echo -e "\n${CYAN}━━━ [3/6] 装 Ollama ━━━${NC}"
if ! command -v ollama &>/dev/null; then
    curl -fsSL https://ollama.com/install.sh | sh
    ok "Ollama 安装完成"
else
    warn "Ollama 已存在: $(ollama --version 2>&1 | head -1)"
fi

# 启动 Ollama
pkill -9 ollama 2>/dev/null || true
sleep 1
nohup ollama serve > /tmp/ollama.log 2>&1 &
disown
sleep 4
curl -s http://127.0.0.1:11434/api/tags > /dev/null && ok "Ollama 服务已启动" || err "Ollama 启动失败"

# ── 第4步：拉 qwen2.5:3b 模型 ──────────────────────
echo -e "\n${CYAN}━━━ [4/6] 拉 qwen2.5:3b 模型 (约 2GB) ━━━${NC}"
if ollama list 2>/dev/null | grep -q qwen2.5; then
    warn "qwen2.5:3b 已存在，跳过下载"
else
    echo "下载中... 腾讯云带宽快，应该 1-2 分钟"
    ollama pull qwen2.5:3b 2>&1 | tail -5
    ok "qwen2.5:3b 下载完成"
fi

# 验证模型
ollama run qwen2.5:3b "你好，回复OK就行" 2>/dev/null | head -3 && ok "模型推理 OK"

# ── 第5步：解压 AI Teams 项目 ──────────────────────
echo -e "\n${CYAN}━━━ [5/6] 部署 AI Teams 项目 ━━━${NC}"
PROJECT_DIR=~/ai_teams
mkdir -p $PROJECT_DIR && cd $PROJECT_DIR

# 项目 base64 (后面追加)
PROJECT_B64="__PROJECT_BASE64__"

if [ -n "$PROJECT_B64" ]; then
    echo "$PROJECT_B64" | base64 -d | tar xz && ok "项目解压完成"
else
    # 没有 base64 就创建最小骨架
    warn "无打包项目，创建最简骨架"
fi

# ── 第6步：装 CrewAI + 验证 ──────────────────────────
echo -e "\n${CYAN}━━━ [6/6] 装 CrewAI + 跑 Demo ━━━${NC}"
pip3 install crewai crewai-tools python-dotenv --break-system-packages -i https://pypi.tuna.tsinghua.edu.cn/simple -q 2>/dev/null || \
pip3 install crewai crewai-tools python-dotenv --break-system-packages -q
ok "CrewAI 安装完成"

# 创建 .env
cat > .env << 'ENV'
# Ollama 本地模型 (完全免费)
LLM_PROVIDER=ollama
LLM_MODEL=qwen2.5:3b
OLLAMA_BASE_URL=http://127.0.0.1:11434
ENV
ok ".env 配置完成 (ollama 本地，¥0)"

# 创建启动脚本
cat > start.sh << 'STARTSH'
#!/bin/bash
export OLLAMA_BASE_URL=http://127.0.0.1:11434
cd ~/ai_teams

# 确保 Ollama 在跑
if ! curl -s http://127.0.0.1:11434/api/tags > /dev/null 2>&1; then
    pkill -9 ollama 2>/dev/null
    nohup ollama serve > /tmp/ollama.log 2>&1 &
    sleep 4
fi

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║              🤖 AI Teams 控制台                          ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "  可用团队:"
echo "    1) dev        DevCrew        - 软件开发"
echo "    2) data       DataCrew       - 数据分析"
echo "    3) content    ContentCrew    - 内容创作"
echo "    4) research   ResearchCrew    - 研究调查"
echo "    5) pm         PMCrew         - 项目管理"
echo "    6) devops     DevOpsCrew     - 运维部署"
echo "    7) design     DesignCrew     - 产品设计"
echo ""
echo "  示例:"
echo "    python3 main.py run dev --input '用Python写一个FastAPI用户认证API'"
echo "    python3 main.py run data --input '分析Q1销售数据趋势'"
echo "    python3 main.py list"
echo ""

if [ "$1" != "" ]; then
    python3 main.py "$@"
else
    bash
fi
STARTSH
chmod +x start.sh

# 快速测试
echo -e "\n${CYAN}── 快速冒烟测试 ──${NC}"
if [ -f main.py ]; then
    python3 main.py list 2>&1 | head -20
fi

# ── 完成 ─────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║               🎉 部署完成！                              ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║                                                          ║"
echo "║  📁 项目目录: ~/ai_teams                                 ║"
echo "║  🦙 Ollama:   http://127.0.0.1:11434 (后台运行)          ║"
echo "║  🧠 模型:     qwen2.5:3b (完全免费, 本地推理)           ║"
echo "║                                                          ║"
echo "║  启动: cd ~/ai_teams && bash start.sh                    ║"
echo "║  或:   python3 ~/ai_teams/main.py list                   ║"
echo "║                                                          ║"
echo "╚══════════════════════════════════════════════════════════╝"
