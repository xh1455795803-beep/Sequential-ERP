#!/bin/bash
# ============================================
# WMS v5 ONE-KEY DEPLOY SCRIPT
# Run this on the SERVER (43.133.232.81) where:
#   - Supabase Docker is running (supabase-db + supabase-edge-functions)
#   - nginx serves /wms/ alias /var/www/wms/
#   - SSH can reach this box from your current terminal
# ============================================
set -e
cd "$(dirname "$0")"

SERVER="ubuntu@43.133.232.81"
REMOTE="/home/ubuntu"

echo "=============================================="
echo " WMS v5 DEPLOY — $(date '+%Y-%m-%d %H:%M:%S')"
echo "=============================================="

# --- Step 1: Upload DB migration ---
echo ""
echo "📦 Step 1: Uploading DB migration..."
scp db_wms_v5.sql "$SERVER:$REMOTE/"

# --- Step 2: Execute DB migration (cleanup + new tables + triggers) ---
echo ""
echo "🗄️  Step 2: Executing DB migration..."
ssh "$SERVER" "sudo docker cp $REMOTE/db_wms_v5.sql supabase-db:/tmp/ && sudo docker exec supabase-db psql -U supabase_admin -d postgres -f /tmp/db_wms_v5.sql 2>&1 | tail -20"

# --- Step 3: Verify DB state ---
echo ""
echo "🔍 Step 3: Verifying DB..."
ssh "$SERVER" "sudo docker exec supabase-db psql -U supabase_admin -d postgres -c \"
  SELECT 'Total wms_ tables' as metric, count(*) as val FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'wms_%'
  UNION ALL
  SELECT 'warehouses (should be 0 after cleanup)', count(*) FROM wms_warehouses
  UNION ALL
  SELECT 'inventory (should be 0)', count(*) FROM wms_inventory
  UNION ALL
  SELECT 'fba_returns', count(*) FROM wms_fba_returns
  UNION ALL
  SELECT 'work_orders', count(*) FROM wms_work_orders
  UNION ALL
  SELECT 'shipment_cancellations', count(*) FROM wms_shipment_cancellations;\""

# --- Step 4: Upload frontend dist ---
echo ""
echo "📤 Step 4: Uploading frontend..."
scp -r dist/* "$SERVER:/tmp/wms_dist/"

# --- Step 5: Deploy nginx ---
echo ""
echo "🌐 Step 5: Deploying to /var/www/wms/"
ssh "$SERVER" "
  sudo rm -rf /var/www/wms.bak.* && \
  sudo mv /var/www/wms /var/www/wms.bak.\$(date +%s) 2>/dev/null || true && \
  sudo mkdir -p /var/www/wms && \
  sudo cp -a /tmp/wms_dist/. /var/www/wms/ && \
  sudo chown -R www-data:www-data /var/www/wms/ && \
  rm -rf /tmp/wms_dist && \
  echo 'nginx deploy OK'
"

# --- Step 6: Upload + restart Edge Functions ---
echo ""
echo "⚡ Step 6: Deploying Edge Functions..."
for func in wms-putaway-suggest wms-pick-path; do
  if [ -f "edge-$func.ts" ]; then
    ssh "$SERVER" "sudo mkdir -p /opt/supabase/docker/volumes/functions/$func"
    scp "edge-$func.ts" "$SERVER:/tmp/index.ts"
    ssh "$SERVER" "sudo cp /tmp/index.ts /opt/supabase/docker/volumes/functions/$func/index.ts && rm /tmp/index.ts"
    echo "  ✓ $func"
  fi
done
if ssh "$SERVER" "docker ps | grep supabase-edge-functions" | grep -q edge; then
  ssh "$SERVER" "sudo docker restart supabase-edge-functions"
  echo "  ✓ supabase-edge-functions restarted"
fi

# --- Step 7: Restart supabase-rest for new FKs ---
echo ""
echo "🔌 Step 7: Restarting supabase-rest..."
ssh "$SERVER" "sudo docker restart supabase-rest" 2>/dev/null || true

# --- Step 8: Verify ---
echo ""
echo "✅ Step 8: Verification"
echo "  curl https://thalvior.icu/wms/ → check bundle hash:"
curl -sk "https://thalvior.icu/wms/" 2>/dev/null | grep -o 'index-[A-Za-z0-9_\.]*.js' | head -3 || echo "  (curl timed out — OK if proxy is slow)"

echo ""
echo "=============================================="
echo " ✅ WMS v5 DEPLOY COMPLETE"
echo " Login: https://thalvior.icu/wms/ → admin@thalvior.icu / Thalvior@WMS2026"
echo " DB migrated, frontend deployed, Edge Functions restarted"
echo "=============================================="
