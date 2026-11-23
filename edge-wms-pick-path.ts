// ============================================================
// 🛒 WMS Smart Picking Path Edge Function
// POST /functions/v1/wms-pick-path
// Algorithm: zone-group → aisle-rack-level sort → optimize route → assign pickers
// ============================================================
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface PickItem {
  sku: string;
  sku_name?: string;
  qty: number;
  from_location_id?: string;  // optional hint
  shipment_item_id?: string;
  product_id?: string;
}

interface PickPathReq {
  shipment_ids?: string[];       // alternative: load from shipments
  warehouse_id: string;
  items?: PickItem[];            // alternative: direct item list
  optimize_for?: "fastest" | "min_zones" | "zone_by_zone";
  num_pickers?: number;          // auto-calculate if not given
}

interface PickTask {
  from_location_id: string;
  from_location_code: string;
  zone_id: string;
  zone_code: string;
  zone_type: string;
  aisle: string | null;
  rack: string | null;
  level: string | null;
  position: string | null;
  sku: string;
  sku_name?: string;
  qty: number;
  shipment_item_id?: string;
  product_id?: string;
  sort_key: string;              // for natural walk order
}

interface PickerRoute {
  picker: string;
  tasks: PickTask[];
  estimated_steps: number;
  total_items: number;
  total_qty: number;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Auth
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ success: false, error: "Missing Authorization" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return json({ success: false, error: "Unauthorized" }, 401);

  // Parse body
  let body: PickPathReq;
  try { body = await req.json(); }
  catch { return json({ success: false, error: "Invalid JSON" }, 400); }

  const { warehouse_id, shipment_ids, items, optimize_for = "fastest", num_pickers } = body;
  if (!warehouse_id) return json({ success: false, error: "warehouse_id required" }, 400);

  // ---- Step 1: Get pick items ----
  let pickItems: PickItem[] = [];

  if (items && items.length > 0) {
    pickItems = items;
  } else if (shipment_ids && shipment_ids.length > 0) {
    const { data: shipItems, error } = await supabase
      .from("wms_shipment_items")
      .select("sku, sku_name, qty, from_location_id, id, product_id")
      .in("shipment_id", shipment_ids)
      .eq("picked", false);
    if (error) return json({ success: false, error: error.message }, 400);
    pickItems = (shipItems || []).map((si: any) => ({
      sku: si.sku, sku_name: si.sku_name, qty: si.qty,
      from_location_id: si.from_location_id,
      shipment_item_id: si.id,
      product_id: si.product_id,
    }));
  } else {
    return json({ success: false, error: "Provide shipment_ids or items" }, 400);
  }

  if (pickItems.length === 0) {
    return json({
      success: true,
      routes: [],
      total_tasks: 0,
      message: "没有待拣选项",
    });
  }

  // ---- Step 2: Find best location for each pick item ----
  // Load inventory with locations for this warehouse
  const { data: inventory } = await supabase
    .from("wms_inventory")
    .select("sku, location_id, qty_available, qty_on_hand")
    .eq("warehouse_id", warehouse_id)
    .gt("qty_available", 0)
    .in("sku", pickItems.map(p => p.sku));

  const invBySkuLoc: Record<string, Map<string, number>> = {};
  (inventory || []).forEach((inv: any) => {
    if (!invBySkuLoc[inv.sku]) invBySkuLoc[inv.sku] = new Map();
    invBySkuLoc[inv.sku].set(inv.location_id, inv.qty_available);
  });

  // Find best location per SKU (closest to dock = lowest aisle/rack = A zone first)
  const { data: locations } = await supabase
    .from("wms_locations")
    .select("id, code, zone_id, aisle, rack, level, position, status, abc_class")
    .eq("warehouse_id", warehouse_id);

  const locMap: Record<string, any> = {};
  (locations || []).forEach(l => { locMap[l.id] = l; });

  const zoneIds = [...new Set((locations || []).map(l => l.zone_id).filter(Boolean))];
  const { data: zones } = await supabase
    .from("wms_zones")
    .select("id, code, name, type")
    .in("id", zoneIds);

  const zoneMap: Record<string, any> = {};
  (zones || []).forEach(z => { zoneMap[z.id] = z; });

  // ---- Step 3: Build pick tasks ----
  const tasks: PickTask[] = [];

  for (const item of pickItems) {
    const invEntries = invBySkuLoc[item.sku];
    if (!invEntries || invEntries.size === 0) {
      // Skip items with no stock
      continue;
    }

    // Pick best location: prefer A zone, lowest aisle, lowest rack
    let bestLoc: any = null;
    let bestScore = Infinity;
    let remaining = item.qty;

    for (const [locId, avail] of invEntries) {
      const loc = locMap[locId];
      if (!loc) continue;
      const zone = zoneMap[loc.zone_id];
      if (!zone) continue;

      // Score: A zone = 0, B = 1, C = 2 + aisle + rack
      const abcScore = (loc.abc_class || "C").charCodeAt(0) - 65; // A=0, B=1, C=2
      const aisleNum = parseInt(loc.aisle || "99", 10);
      const rackNum = parseInt(loc.rack || "99", 10);
      const levelNum = parseInt(loc.level || "9", 10);
      const score = abcScore * 100 + aisleNum * 10 + rackNum + levelNum * 0.5;

      if (score < bestScore) {
        bestScore = score;
        bestLoc = { loc, avail };
      }
    }

    if (bestLoc) {
      const loc = bestLoc.loc;
      const zone = zoneMap[loc.zone_id];
      tasks.push({
        from_location_id: loc.id,
        from_location_code: loc.code,
        zone_id: loc.zone_id,
        zone_code: zone?.code || "-",
        zone_type: zone?.type || "-",
        aisle: loc.aisle,
        rack: loc.rack,
        level: loc.level,
        position: loc.position,
        sku: item.sku,
        sku_name: item.sku_name,
        qty: Math.min(item.qty, bestLoc.avail),
        shipment_item_id: item.shipment_item_id,
        product_id: item.product_id,
        sort_key: buildSortKey(loc),
      });
      remaining -= Math.min(item.qty, bestLoc.avail);
    }

    if (remaining > 0) {
      // Could not fulfill from inventory
      // Mark as incomplete
    }
  }

  if (tasks.length === 0) {
    return json({
      success: true,
      routes: [],
      total_tasks: 0,
      message: "没有可执行的拣选任务（库存不足？）",
    });
  }

  // ---- Step 4: Group & sort by zone, then by natural walk order ----
  // Group tasks by zone_type for zone-based optimization
  tasks.sort((a, b) => {
    // Zone type priority: staging/picking first, storage last
    const zoneTypeOrder: Record<string, number> = { staging: 0, picking: 1, returns: 2, storage: 3 };
    const za = zoneTypeOrder[a.zone_type] ?? 99;
    const zb = zoneTypeOrder[b.zone_type] ?? 99;
    if (za !== zb) return za - zb;

    // Then natural walk order: aisle → rack → level → position
    return a.sort_key.localeCompare(b.sort_key);
  });

  // ---- Step 5: Optimize based on strategy ----
  let finalTasks = tasks;
  let routeTitle = zoneTypeOrder(optimize_for);

  if (optimize_for === "fastest") {
    // Interleave: pick items from same aisle together regardless of zone
    finalTasks = [...tasks].sort((a, b) => {
      const aKey = `${a.aisle || '99'}-${a.rack || '99'}-${a.level || '9'}-${a.position || '99'}`;
      const bKey = `${b.aisle || '99'}-${b.rack || '99'}-${b.level || '9'}-${b.position || '99'}`;
      return aKey.localeCompare(bKey);
    });
  } else if (optimize_for === "min_zones") {
    // Group strictly by zone first, minimizing zone transitions
    finalTasks = [...tasks].sort((a, b) => {
      const zoneA = `${a.zone_code}-${a.aisle || '99'}-${a.rack || '99'}`;
      const zoneB = `${b.zone_code}-${b.aisle || '99'}-${b.rack || '99'}`;
      return zoneA.localeCompare(zoneB);
    });
  }
  // zone_by_zone is default zone-grouped, already done above

  // ---- Step 6: Assign pickers ----
  const totalItems = finalTasks.length;
  const autoPickers = num_pickers || Math.min(10, Math.max(1, Math.ceil(totalItems / 8)));
  const pickerNames = Array.from({ length: autoPickers }, (_, i) => `拣货员-${String(i + 1).padStart(2, "0")}`);

  // Round-robin balanced assignment
  const routes: PickerRoute[] = pickerNames.map(name => ({
    picker: name,
    tasks: [],
    estimated_steps: 0,
    total_items: 0,
    total_qty: 0,
  }));

  // Distribute tasks minimizing total distance
  // Greedy: each task goes to picker with fewer tasks
  for (const task of finalTasks) {
    const leastPicker = routes.reduce((min, r) => r.tasks.length < min.tasks.length ? r : min, routes[0]);
    leastPicker.tasks.push(task);
    leastPicker.total_items += 1;
    leastPicker.total_qty += task.qty;
  }

  // Calculate estimated steps (simplified: zone transitions + locations)
  routes.forEach(r => {
    let steps = r.tasks.length;
    for (let i = 1; i < r.tasks.length; i++) {
      if (r.tasks[i].zone_code !== r.tasks[i - 1].zone_code) steps += 2; // zone cross penalty
    }
    r.estimated_steps = steps;
  });

  return json({
    success: true,
    warehouse_id,
    optimize_for,
    algorithm_version: "v1-zone-path",
    total_tasks: finalTasks.length,
    total_qty: finalTasks.reduce((s, t) => s + t.qty, 0),
    num_pickers: autoPickers,
    routes: routes.filter(r => r.tasks.length > 0),
    route_title: routeTitle,
  });
});

function buildSortKey(loc: any): string {
  const aisle = parseInt(loc.aisle || "999", 10).toString().padStart(3, "0");
  const rack = parseInt(loc.rack || "999", 10).toString().padStart(3, "0");
  const level = parseInt(loc.level || "9", 10).toString().padStart(2, "0");
  const pos = parseInt(loc.position || "999", 10).toString().padStart(3, "0");
  return `${aisle}-${rack}-${level}-${pos}`;
}

function zoneTypeTitle(mode: string): string {
  const titles: Record<string, string> = {
    fastest: "最短路径（按行走距离）",
    min_zones: "最少区域切换",
    zone_by_zone: "逐区域顺序",
  };
  return titles[mode] || mode;
}
// Backward-compatible alias
function zoneTypeOrder(_mode: string): string {
  return zoneTypeTitle(_mode);
}
