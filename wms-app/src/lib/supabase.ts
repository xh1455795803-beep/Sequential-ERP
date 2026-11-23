import { createClient, User } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL || 'https://thalvior.icu';
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw';

export const supabase = createClient(url, anon, {
  auth: { autoRefreshToken: true, persistSession: true },
});

export type PortalRole = 'merchant' | 'warehouse' | 'admin';

export interface AuthContext {
  user: User | null;
  portalRole: PortalRole | null;
  tenantId: string | null;      // merchant_id (商家) / warehouse_id (仓库) / null (admin)
  merchantId: string | null;   // 方便商家端使用
  warehouseId: string | null;  // 方便仓库端使用
}

export async function getAuthContext(): Promise<AuthContext> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, portalRole: null, tenantId: null, merchantId: null, warehouseId: null };
  
  const meta = user.user_metadata || {};
  const role: PortalRole | null = meta.portal_role || null;
  const tenantId: string | null = meta.tenant_id || null;
  
  return {
    user,
    portalRole: role,
    tenantId,
    merchantId: role === 'merchant' ? tenantId : null,
    warehouseId: role === 'warehouse' ? tenantId : null,
  };
}

export function signOut() {
  return supabase.auth.signOut();
}
