#!/usr/bin/env bash
# 每日扫描「7 天内即将到期的会员套餐」并发送到期提醒邮件
# 由 /etc/cron.d/thalvior-mailer 每天 09:00 调用
set -uo pipefail

ENV_FILE="/opt/supabase/docker/.env"
LOG="/var/log/thalvior-mailer-cron.log"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "$(date '+%F %T') ERROR 未找到 $ENV_FILE" >> "$LOG"
  exit 1
fi

SEC=$(grep '^MAILER_SECRET=' "$ENV_FILE" | cut -d= -f2- | tr -d '\r')
SRK=$(grep '^SERVICE_ROLE_KEY=' "$ENV_FILE" | cut -d= -f2- | tr -d '\r')

RESULT=$(curl -s -m 180 -X POST http://127.0.0.1:8000/functions/v1/mailer \
  -H "Content-Type: application/json" \
  -H "apikey: $SRK" \
  -H "x-mailer-secret: $SEC" \
  -d '{"action":"cron","scene":"membership_expiring"}')

echo "$(date '+%F %T') $RESULT" >> "$LOG"
