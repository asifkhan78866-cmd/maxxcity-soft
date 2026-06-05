// ═══════════════════════════════════════
// Admin Zustand Store
// ═══════════════════════════════════════
// Global state for admin dashboard filters, date ranges, settings

'use client';

import { create } from 'zustand';

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

  // Settings
  settings: {
    store_name: string;
    store_address: string;
    store_gstin: string;
    store_phone: string;
    default_price: number;
    low_stock_default: number;
    thursday_target_multiplier: number;
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
    store_name: process.env.NEXT_PUBLIC_STORE_NAME || 'MaxxCity Mall',
    store_address: process.env.NEXT_PUBLIC_STORE_ADDRESS || 'Ramnagar Main Road, Adilabad, Telangana 504001',
    store_gstin: process.env.NEXT_PUBLIC_STORE_GSTIN || '',
    store_phone: process.env.NEXT_PUBLIC_STORE_PHONE || '',
    default_price: 149,
    low_stock_default: 20,
    thursday_target_multiplier: 1.25,
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
