// ═══════════════════════════════════════
// Admin Zustand Store
// ═══════════════════════════════════════
// Global state for admin dashboard filters, date ranges, settings

'use client';

import { create } from 'zustand';
import { DEFAULT_PRODUCT_PRICE, DEFAULT_LOW_STOCK_THRESHOLD } from '@/lib/config/pricing';
import { STORE_CONFIG } from '@/lib/config/store';

interface AdminState {
  // Date range filters
  dateRange: {
    from: Date;
    to: Date;
  };

  // Active tab in various views
  activeTab: string;

  // Dashboard
  dashboardPeriod: 'today' | 'week' | 'month';

  // Top products toggle
  topProductsPeriod: 'week' | 'month';

  /**
   * Store identity for display. The selling price is READ-ONLY here — it is a
   * business rule owned by lib/config/pricing.ts, not editable UI state.
   */
  settings: {
    store_name: string;
    store_address: string;
    store_gstin: string;
    store_phone: string;
    readonly default_product_price: number;
    low_stock_default: number;
  };

  // Sidebar
  sidebarOpen: boolean;

  // Actions
  setDateRange: (from: Date, to: Date) => void;
  setActiveTab: (tab: string) => void;
  setDashboardPeriod: (period: 'today' | 'week' | 'month') => void;
  setTopProductsPeriod: (period: 'week' | 'month') => void;
  setSettings: (settings: Partial<AdminState['settings']>) => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
}

const today = new Date();
const weekAgo = new Date(today);
weekAgo.setDate(weekAgo.getDate() - 7);

export const useAdminStore = create<AdminState>((set) => ({
  dateRange: {
    from: weekAgo,
    to: today,
  },

  activeTab: 'overview',
  dashboardPeriod: 'today',
  topProductsPeriod: 'week',

  settings: {
    store_name: STORE_CONFIG.name,
    store_address: `${STORE_CONFIG.address}, ${STORE_CONFIG.city}`,
    store_gstin: STORE_CONFIG.gstin,
    store_phone: STORE_CONFIG.phone,
    default_product_price: DEFAULT_PRODUCT_PRICE,
    low_stock_default: DEFAULT_LOW_STOCK_THRESHOLD,
  },

  sidebarOpen: true,

  setDateRange: (from, to) => set({ dateRange: { from, to } }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setDashboardPeriod: (period) => set({ dashboardPeriod: period }),
  setTopProductsPeriod: (period) => set({ topProductsPeriod: period }),
  setSettings: (newSettings) =>
    set((state) => ({
      settings: { ...state.settings, ...newSettings },
    })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
}));
