'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Package,
  Receipt,
  Users,
  BarChart3,
  CreditCard,
  Brain,
  ShoppingCart,
  Store,
  ChevronLeft,
  ChevronRight,
  LogOut,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAdminStore } from '@/store/admin.store';
import { Separator } from '@/components/ui/separator';

const navItems = [
  { href: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/inventory', label: 'Inventory', icon: Package },
  { href: '/admin/sales', label: 'Sales History', icon: Receipt },
  { href: '/admin/staff', label: 'Staff', icon: Users },
  { href: '/admin/reports', label: 'Reports', icon: BarChart3 },
  { href: '/admin/emi', label: 'EMI Tracker', icon: CreditCard },
  { href: '/admin/ai', label: 'AI Insights', icon: Brain },
];

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { sidebarOpen, toggleSidebar } = useAdminStore();

  return (
    <div className="min-h-screen flex bg-background">
      {/* ─── Sidebar ─── */}
      <aside
        className={cn(
          'fixed left-0 top-0 h-full bg-sidebar text-sidebar-foreground flex flex-col transition-all duration-300 z-50',
          sidebarOpen ? 'w-64' : 'w-[68px]'
        )}
      >
        {/* Logo */}
        <div className="h-16 flex items-center px-4 gap-3 shrink-0">
          <div className="w-9 h-9 rounded-lg bg-sidebar-primary flex items-center justify-center shrink-0">
            <Store className="w-5 h-5 text-white" />
          </div>
          {sidebarOpen && (
            <div className="fade-in">
              <h2 className="font-bold text-sm leading-tight">MaxxCity Mall</h2>
              <p className="text-[10px] text-sidebar-foreground/60">Admin Panel</p>
            </div>
          )}
        </div>

        <Separator className="bg-white/10" />

        {/* Nav Items */}
        <nav className="flex-1 py-3 px-2 space-y-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all',
                  isActive
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                    : 'text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-white/5'
                )}
              >
                <item.icon className={cn('w-5 h-5 shrink-0', isActive && 'text-maxx-gold')} />
                {sidebarOpen && <span className="truncate">{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        <Separator className="bg-white/10" />

        {/* Bottom Actions */}
        <div className="p-2 space-y-1">
          <Link
            href="/billing"
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-white/5 transition-all"
          >
            <ShoppingCart className="w-5 h-5 shrink-0" />
            {sidebarOpen && <span>POS Billing</span>}
          </Link>
          <button
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-sidebar-foreground/70 hover:text-red-400 hover:bg-white/5 transition-all w-full"
            onClick={() => {
              document.cookie = 'maxxcity_pin_session=; path=/; max-age=0';
              window.location.href = '/login';
            }}
          >
            <LogOut className="w-5 h-5 shrink-0" />
            {sidebarOpen && <span>Logout</span>}
          </button>
        </div>

        {/* Collapse Toggle */}
        <div className="p-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-center text-sidebar-foreground/50 hover:text-sidebar-foreground"
            onClick={toggleSidebar}
          >
            {sidebarOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </Button>
        </div>
      </aside>

      {/* ─── Main Content ─── */}
      <main
        className={cn(
          'flex-1 transition-all duration-300 h-screen overflow-y-auto',
          sidebarOpen ? 'ml-64' : 'ml-[68px]'
        )}
      >
        {children}
      </main>
    </div>
  );
}
