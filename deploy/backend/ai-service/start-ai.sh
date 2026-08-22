#!/usr/bin/env bash
# 数序ERP V2.0 AI 服务启动脚本
# 用法：
#   ./start-ai.sh            # 后台启动，默认端口 8765，开启降级兜底模式
#   AI_DEGRADED=0 ./start-ai.sh  # 非降级模式（必须确保所有依赖可运行）
#   PORT=8766 ./start-ai.sh  # 自定义端口
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
export AI_DEGRADED="${AI_DEGRADED:-1}"
export AI_DEGRADED_REASON="heuristics_fallback_部署脚本默认兜底模式；装完numpy/scipy可改0"
PORT="${PORT:-8765}"
BIND="${BIND:-127.0.0.1}"
LOG="${DIR}/ai-service.log"
PID_FILE="${DIR}/ai-service.pid"

if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE" 2>/dev/null)" 2>/dev/null; then
  echo "[ai-service] 已在运行 PID=$(cat "$PID_FILE")，先执行 stop 再启动"
  exit 1
fi

# 确保 venv 存在（若无则用系统 python）
if [ -d "$DIR/.venv" ]; then
  PY="$DIR/.venv/bin/python"
  PIP="$DIR/.venv/bin/pip"
else
  PY="$(command -v python3 || command -v python)"
  PIP="$(command -v pip3 || command -v pip)"
fi

# 启动时若缺依赖，自动尝试安装 fastapi/uvicorn/pydantic（失败也不阻塞，走HTTP降级）
if ! "$PY" -c "import fastapi, uvicorn" 2>/dev/null; then
  echo "[ai-service] 首次启动尝试补装依赖..."
  nohup "$PIP" install --quiet "fastapi>=0.109,<0.116" "uvicorn>=0.27,<0.31" "pydantic>=2.5,<3.0" "PyMySQL>=1.1,<1.2" >/dev/null 2>&1 || true
  sleep 1
fi

nohup "$PY" main.py > "$LOG" 2>&1 &
echo $! > "$PID_FILE"
sleep 1
if kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "[ai-service] ✅ 启动成功: PID=$(cat "$PID_FILE")  http://$BIND:$PORT/health   日志=$LOG"
else
  echo "[ai-service] ❌ 启动失败，见日志：$LOG"
  tail -n 30 "$LOG" 2>/dev/null || true
  exit 2
fi
