/**
 * meoo 当前仓库选择 —— 跨页面共享
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface WarehouseState {
  warehouseId: number | null;
  warehouseName: string | null;
  setWarehouse: (id: number, name: string) => void;
  clear: () => void;
}

export const useWarehouseStore = create<WarehouseState>()(
  persist(
    (set) => ({
      warehouseId: null,
      warehouseName: null,
      setWarehouse: (id, name) => set({ warehouseId: id, warehouseName: name }),
      clear: () => set({ warehouseId: null, warehouseName: null }),
    }),
    { name: 'thalvior.warehouse' }
  )
);
