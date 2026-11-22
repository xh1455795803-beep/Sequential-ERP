#!/bin/bash
# =============================================================================
# fill-legal.sh — 一次性把合规主体真实值写入所有展示位（wave B 20261117）
#
# 用法（root 或 ubuntu 皆可，涉及 /var/www 时需要 sudo）：
#   APPLY=1 \
#   COMPANY_NAME='深圳市某某科技有限公司' \
#   USCC='91440300XXXXXXXXXX' \
#   ICP_FILING='粤ICP备2026XXXXXX号-1' \
#   POLICE_FILING='粤公网安备44030000000000号' \
#   ADDRESS='深圳市南山区某某路某某大厦XX层' \
#   PHONE='400-XXX-XXXX' \
#   LEGAL_REP='张三' \
#   bash /opt/thalvior-source/ops/scripts/fill-legal.sh
#
# 作用范围（占位文案 -> 真实值，全量替换）：
#   1) /var/www/legal/{terms,privacy,refund}.html      （公开法务页，纯静态，立即生效）
#   2) /var/www/landing/index.html                     （落地页页脚，立即生效）
#   3) /opt/thalvior-source/.env.production.local      （前端构建期 VITE_* 注入）
# 之后需重新构建并发布 SPA：bash /opt/thalvior-source/ops/scripts/deploy-web.sh
#
# 安全：不带 APPLY=1 一律拒绝执行（exit 3）。先用演练模式验证：
#   mkdir -p /tmp/drill/legal && cp /var/www/legal/*.html /tmp/drill/legal/ \
#   && cp /var/www/landing/index.html /tmp/drill/index.html
#   LEGAL_ROOT=/tmp/drill/legal LANDING_FILE=/tmp/drill/index.html OUT_ENV=/tmp/drill.env \
#     APPLY=1 COMPANY_NAME=... bash $0
#
# 幂等：重复执行只覆盖同一批占位；旧真实值不会自动回收，回滚用
#       /opt/thalvior-source/wB-backup-20261117/*.bak-20261117-wB 或本脚本的 BK 目录。
# =============================================================================
set -euo pipefail

: "${COMPANY_NAME:?请设置 COMPANY_NAME（营业执照全称）}"
: "${USCC:?请设置 USCC（统一社会信用代码）}"
: "${ICP_FILING:?请设置 ICP_FILING（如 粤ICP备2026XXXXXX号-1）}"
: "${POLICE_FILING:=}"      # 公安备案号可留空（未做公安备案时）
: "${ADDRESS:?请设置 ADDRESS（注册地址）}"
: "${PHONE:?请设置 PHONE（客服电话）}"
: "${LEGAL_REP:?请设置 LEGAL_REP（法定代表人）}"
: "${SUPPORT_EMAIL:=}"      # 留空则保留现有默认邮箱（thalvior@foxmail.com）

# 可覆盖目标路径，便于在副本上做无人值守演练
LEGAL_ROOT=${LEGAL_ROOT:-/var/www/legal}
LANDING_FILE=${LANDING_FILE:-/var/www/landing/index.html}
OUT_ENV=${OUT_ENV:-/opt/thalvior-source/.env.production.local}

if [ "${APPLY:-0}" != "1" ]; then
  echo "拒绝执行：这是会改写公开法务页的动作。"
  echo "目标：$LEGAL_ROOT/*.html 、 $LANDING_FILE 、 $OUT_ENV"
  echo "先做演练：LEGAL_ROOT=/tmp/drill/legal LANDING_FILE=/tmp/drill/index.html OUT_ENV=/tmp/drill.env bash $0 ..."
  echo "确认无误后加 APPLY=1 正式执行。"
  exit 3
fi
echo "目标文件："; printf '  %s\n' "$LEGAL_ROOT" "$LANDING_FILE" "$OUT_ENV"

SUDO=""
[ "$(id -u)" != "0" ] && SUDO="sudo"
BK=/opt/thalvior-source/wB-backup-20261117/fill-$(date +%Y%m%d-%H%M%S)
$SUDO mkdir -p "$BK" 2>/dev/null || mkdir -p "$BK"

# sed 安全转义（用 | 作分隔符，避免地址/备案号里的 / 与 & 造成问题）
esc() { printf '%s' "$1" | sed -e 's/[\\|&]/\\&/g'; }
C=$(esc "$COMPANY_NAME"); U=$(esc "$USCC"); I=$(esc "$ICP_FILING")
P=$(esc "$POLICE_FILING"); A=$(esc "$ADDRESS"); T=$(esc "$PHONE"); R=$(esc "$LEGAL_REP")

FILES=("$LEGAL_ROOT/terms.html" "$LEGAL_ROOT/privacy.html" "$LEGAL_ROOT/refund.html" "$LANDING_FILE")

SEDEXPR=(-e "s|（公司名待补）|$C|g"
         -e "s|（统一社会信用代码待补）|$U|g"
         -e "s|（ICP 备案号待补）|$I|g"
         -e "s|（注册地址待补）|$A|g"
         -e "s|（客服电话待补）|$T|g"
         -e "s|（法定代表人待补）|$R|g")
[ -n "$POLICE_FILING" ] && SEDEXPR+=(-e "s|（公安备案号待补）|$P|g")

apply() { # $1=file
  local f="$1"
  [ -f "$f" ] || { echo "跳过（不存在）: $f"; return; }
  $SUDO cp -a "$f" "$BK/$(basename "$f")" 2>/dev/null || cp -a "$f" "$BK/$(basename "$f")"
  $SUDO sed -i "${SEDEXPR[@]}" "$f"
  echo "已填充: $f"
}

for f in "${FILES[@]}"; do apply "$f"; done

# 公安备案号留空时，清掉那半句，避免线上出现空占位
if [ -z "$POLICE_FILING" ]; then
  for f in "${FILES[@]}"; do
    [ -f "$f" ] && $SUDO sed -i -e 's|（公安备案号待补） · ||g' -e 's|公安备案号：<b>（公安备案号待补）</b> ||g' "$f" || true
  done
fi

# 前端构建期变量
ENVF=$OUT_ENV
$SUDO touch "$ENVF" 2>/dev/null || touch "$ENVF"
KV=("VITE_COMPANY_NAME=$COMPANY_NAME" "VITE_USCC=$USCC" "VITE_ICP_FILING=$ICP_FILING" \
    "VITE_ADDRESS=$ADDRESS" "VITE_PHONE=$PHONE" "VITE_LEGAL_REP=$LEGAL_REP")
[ -n "$POLICE_FILING" ]  && KV+=("VITE_POLICE_FILING=$POLICE_FILING")
[ -n "$SUPPORT_EMAIL" ]  && KV+=("VITE_SUPPORT_EMAIL=$SUPPORT_EMAIL")
for kv in "${KV[@]}"; do
  k=${kv%%=*}
  $SUDO sed -i "/^$k=/d" "$ENVF" 2>/dev/null || true
  printf '%s\n' "$kv" | $SUDO tee -a "$ENVF" >/dev/null 2>&1 || printf '%s\n' "$kv" >> "$ENVF"
done
echo "已写入: $ENVF"

LEFT=0
for f in "${FILES[@]}"; do
  [ -f "$f" ] || continue
  n=$($SUDO grep -c "待补" "$f" 2>/dev/null || true)
  LEFT=$((LEFT + ${n:-0}))
done
echo
echo "剩余未替换占位（应为 0）: $LEFT"
[ "$LEFT" != "0" ] && $SUDO grep -rno "（[^）]*待补）" "${FILES[@]}" 2>/dev/null | head -10
echo
echo "下一步：重新构建并发布 SPA（wave B 不允许代为执行 npm run build）"
echo "  bash /opt/thalvior-source/ops/scripts/deploy-web.sh"
