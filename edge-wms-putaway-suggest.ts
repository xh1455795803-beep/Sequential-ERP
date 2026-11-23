// ============================================================
// 📦 WMS Smart Putaway Suggestion Edge Function
// POST /functions/v1/wms-putaway-suggest
// Algorithm: batch-together → abc_class → zone_type → empty-location
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

interface SuggestReq {
  warehouse_id: string;
  sku: string;
  expected_qty?: number;
  abc_class?: "A" | "B" | "C";
  expiry_enabled?: boolean;
  prefer_same_batch?: boolean;
}

interface Suggestion {
  location_id: string;
  code: string;
  zone_id: string;
  zone_code: string;
  zone_type: string;
  aisle: string | null;
  rack: string | null;
  level: string | null;
  position: string | null;
  abc_class: string | null;
  score: number;
  reason: string;
  current_sku?: string;
  current_qty?: number;
  is_empty?: boolean;
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
  let body: SuggestReq;
  try { body = await req.json(); }
  catch { return json({ success: false, error: "Invalid JSON" }, 400); }

  const { warehouse_id, sku, expected_qty = 1, abc_class, expiry_enabled } = body;
  if (!warehouse_id || !sku) return json({ success: false, error: "warehouse_id and sku required" }, 400);

  // ---- Fetch all data ----
  // 1. Existing inventory for this SKU at this warehouse (batch together logic)
  const { data: existingInv } = await supabase
    .from("wms_inventory")
    .select("id, location_id, sku, qty_on_hand, expiry_date, batch_no")
    .eq("warehouse_id", warehouse_id)
    .eq("sku", sku)
    .gt("qty_on_hand", 0);

  // 2. All locations in this warehouse with zone + abc_class
  const { data: locations } = await supabase
    .from("wms_locations")
    .select("id, code, zone_id, aisle, rack, level, position, status, abc_class")
    .eq("warehouse_id", warehouse_id);

  // 3. Zones
  const zoneIds = [...new Set((locations || []).map(l => l.zone_id).filter(Boolean))];
  const { data: zones } = await supabase
    .from("wms_zones")
    .select("id, code, name, type")
    .in("id", zoneIds);

  // Map zone_id → zone
  const zoneMap: Record<string, any> = {};
  (zones || []).forEach(z => { zoneMap[z.id] = z; });

  // ---- Candidate evaluation ----
  const suggestions: Suggestion[] = [];
  const locs = locations || [];

  for (const loc of locs) {
    const zone = zoneMap[loc.zone_id];
    if (!zone) continue;

    let score = 0;
    const reasons: string[] = [];

    // Rule 1: Already has this SKU → HIGH priority (batch together)
    const existing = existingInv?.find(i => i.location_id === loc.id);
    if (existing) {
      score += 100;
      reasons.push("已有相同SKU库存（合批）");
    }

    // Rule 2: abc_class matching with location's abc_class
    const targetAbc = abc_class || loc.abc_class;
    if (loc.abc_class === targetAbc) {
      score += 30;
      reasons.push(`ABC匹配(${loc.abc_class})`);
    } else {
      // Penalty for mismatch
      score -= Math.abs(charCodeDiff(loc.abc_class, targetAbc)) * 15;
    }

    // Rule 3: Zone type matching based on ABC class
    // A → picking/fast (closest to dock), C → storage (deep), B → either
    const zoneType = zone.type;
    const abcPriority = { A: ["picking", "staging"], B: ["storage", "picking"], C: ["storage", "returns"] };
    const preferredZones = abcPriority[targetAbc as "A" | "B" | "C"] || abcPriority.C;

    if (preferredZones.includes(zoneType)) {
      score += 25;
      reasons.push(`区域类型匹配(${zoneType})`);
    } else {
      score -= 20;
    }

    // Rule 4: Empty locations get bonus
    if (loc.status === "empty") {
      score += 15;
      reasons.push("库位空闲");
    } else if (!existing) {
      // Occupied but not our SKU → small penalty
      score -= 10;
    }

    // Rule 5: Aisle/rack proximity bonus (lower aisle/rack number = closer to dock)
    const aisleNum = parseInt(loc.aisle || "999", 10);
    const rackNum = parseInt(loc.rack || "999", 10);
    if (!isNaN(aisleNum) && aisleNum <= 5) score += Math.max(0, 10 - aisleNum * 2);
    if (!isNaN(rackNum) && rackNum <= 3) score += Math.max(0, 6 - rackNum * 2);

    // Rule 6: Expiry-aware - prefer locations with matching/earlier expiry for FIFO/FEFO
    if (expiry_enabled && existing?.expiry_date) {
      score += 20;
      reasons.push("效期相关");
    }

    if (score > 0 || loc.status === "empty") {
      suggestions.push({
        location_id: loc.id,
        code: loc.code,
        zone_id: loc.zone_id,
        zone_code: zone.code,
        zone_type: zoneType,
        aisle: loc.aisle,
        rack: loc.rack,
        level: loc.level,
        position: loc.position,
        abc_class: loc.abc_class,
        score,
        reason: reasons.join(" + ") || "可用库位",
        current_sku: existing?.sku,
        current_qty: existing?.qty_on_hand,
        is_empty: loc.status === "empty",
      });
    }
  }

  // Sort by score descending
  suggestions.sort((a, b) => b.score - a.score);

  // Also: if existingInv found, boost their location IDs
  const topExistingLocIds = (existingInv || []).map(i => i.location_id);
  suggestions.forEach(s => {
    if (topExistingLocIds.includes(s.location_id)) s.score += 50;
  });
  suggestions.sort((a, b) => b.score - a.score);

  return json({
    success: true,
    warehouse_id,
    sku,
    abc_class: abc_class || "auto",
    suggestions: suggestions.slice(0, 3),
    total_candidates: suggestions.length,
    algorithm_version: "v1-smart",
  });
});

function charCodeDiff(a: string | null | undefined, b: string | null | undefined): number {
  if (!a || !b) return 1;
  return Math.abs(a.charCodeAt(0) - b.charCodeAt(0));
}
