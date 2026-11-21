/**
 * WMS Domain 类型定义 —— 所有表的 TypeScript 类型
 */

export interface WmsWarehouse {
  id: number;
  tenant_id: number;
  warehouse_code: string;
  name: string;
  address?: string;
  contact_name?: string;
  contact_phone?: string;
  is_3pl: boolean;
  capacity?: number;
  status: number;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface WmsZone {
  id: number;
  tenant_id: number;
  warehouse_id: number;
  zone_code: string;
  name: string;
  type: string;
  created_at: string;
  updated_at: string;
}

export interface WmsBin {
  id: number;
  tenant_id: number;
  warehouse_id: number;
  zone_id?: number;
  bin_code: string;
  zone_type?: string;
  is_pickable: boolean;
  created_at: string;
}

export interface WmsProduct {
  id: number;
  tenant_id: number;
  sku_code: string;
  name: string;
  barcode?: string;
  unit_price?: number;
  status: number;
  created_at: string;
  updated_at: string;
}

export interface WmsInventory {
  id: number;
  tenant_id: number;
  warehouse_id: number;
  product_id: number;
  bin_id?: number;
  qty_onhand: number;
  qty_locked?: number;
  created_at: string;
  updated_at: string;
  // joined
  product_name?: string;
  sku_code?: string;
  bin_code?: string;
}

export interface WmsOrder {
  id: number;
  tenant_id: number;
  warehouse_id?: number;
  erp_order_no: string;
  platform?: string;
  channel?: string;
  status: number;
  receiver_name?: string;
  receiver_phone?: string;
  receiver_address?: string;
  exception_flag?: number;
  exception_type?: string;
  created_at: string;
  updated_at: string;
}

export interface WmsInboundReceipt {
  id: number;
  tenant_id: number;
  warehouse_id: number;
  receipt_no: string;
  receipt_type: string;
  carrier?: string;
  tracking_no?: string;
  status: number;
  expected_qty?: number;
  received_qty?: number;
  difference_qty?: number;
  created_at: string;
  updated_at: string;
}

export interface WmsShipmentLabel {
  id: number;
  tenant_id: number;
  warehouse_id?: number;
  order_id?: number;
  label_no: string;
  shipping_channel?: string;
  tracking_no?: string;
  status: number;
  label_url?: string;
  created_at: string;
}

export interface WmsStocktaking {
  id: number;
  tenant_id: number;
  warehouse_id: number;
  stocktake_no: string;
  zone_id?: number;
  status: number;
  diff_qty: number;
  total_qty: number;
  diff_flag: boolean;
  operator_id?: string;
  started_at?: string;
  completed_at?: string;
  remark?: string;
  created_at: string;
  updated_at: string;
}

export interface WmsException {
  id: number;
  tenant_id: number;
  warehouse_id?: number;
  exception_no: string;
  exception_type: string;
  source_type?: string;
  source_id?: number;
  description?: string;
  status: number;
  created_at: string;
}

export interface WmsShippingChannel {
  id: number;
  tenant_id: number;
  name: string;
  adapter?: string;
  status: number;
  created_at: string;
}
