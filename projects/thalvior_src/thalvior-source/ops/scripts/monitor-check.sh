#!/bin/bash
# Thalvior 商用监控：HTTP/磁盘/内存/服务 异常告警（站内通知+邮件+日志）
# 每5分钟由 cron 执行；状态文件防止重复告警
BASE=/opt/thalvior-monitor
STATE=$BASE/state.json
LOG=$BASE/monitor.log
USER_ID=266353cb-d9e9-461d-8575-7ae50b68e8dc
[ -f "$STATE" ] || echo 'init' > "$STATE"
ts=$(date '+%Y-%m-%d %H:%M:%S')
issues=""

# 1) Web 首页
code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 https://thalvior.icu/ 2>/dev/null)
if [ "$code" != "200" ]; then issues="$issues|WEB首页HTTP=$code"; fi

# 2) 磁盘
disk=$(df -h / | awk 'NR==2{print +$5}')
if [ "$disk" -ge 85 ]; then issues="$issues|磁盘使用=${disk}%"; fi

# 3) 内存可用
mem_free=$(free -m | awk 'NR==2{print $7}')
if [ "$mem_free" -lt 200 ]; then issues="$issues|内存可用=${mem_free}MB"; fi

# 4) 核心容器
for c in supabase-db supabase-auth supabase-rest supabase-edge-functions supabase-storage; do
  st=$(cd /opt/supabase/docker && sudo docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null)
  [ "$st" != "true" ] && issues="$issues|容器${c}停止"
done

# 5) nginx 进程
pgrep -x nginx >/dev/null || issues="$issues|nginx进程不存在"

prev=$(cat "$STATE")
if [ -z "$issues" ]; then
  if [ "$prev" != "ok" ]; then
    echo "$ts 系统恢复正常" >> "$LOG"
    cd /opt/supabase/docker && sudo docker exec -i $(sudo docker compose ps -q db) psql -U postgres -d postgres -c \
      "INSERT INTO notifications (user_id, title, content, type, is_read, created_at) VALUES ('$USER_ID', '系统监控恢复正常', '服务器各项指标恢复正常。', '系统', false, now());" >> "$LOG" 2>&1
  fi
  echo "ok" > "$STATE"
else
  if [ "$prev" != "$issues" ]; then
    echo "$ts 告警:$issues" >> "$LOG"
    python3 - "$ts" "$issues" <<'PYEOF'
import sys, smtplib, email.message
ts, issues = sys.argv[1], sys.argv[2]
msg = email.message.EmailMessage()
msg["From"] = "thalvior@foxmail.com"; msg["To"] = "thalvior@foxmail.com"
msg["Subject"] = "[Thalvior告警] " + ts
msg.set_content("服务器异常项：" + issues)
try:
    s = smtplib.SMTP("smtp.qq.com", 587, timeout=20)
    s.ehlo(); s.starttls(); s.ehlo()
    s.login("thalvior@foxmail.com", "ovxivorczfmlibfj")
    s.send_message(msg); s.quit(); print("mail-sent")
except Exception as e:
    print("mail-fail:", e)
PYEOF
    cd /opt/supabase/docker && sudo docker exec -i $(sudo docker compose ps -q db) psql -U postgres -d postgres -c \
      "INSERT INTO notifications (user_id, title, content, type, is_read, created_at) VALUES ('$USER_ID', '系统监控告警', '服务器异常：$issues', '系统', false, now());" >> "$LOG" 2>&1
  fi
  echo "$issues" > "$STATE"
fi
