'use client';

// ═══════════════════════════════════════
// Admin Layout
// ═══════════════════════════════════════
// The sidebar only shows links the signed-in role can actually use. That is a
// convenience: Proxy blocks the page load and each API route re-checks the
// permission, so hiding a link is never what keeps anyone out.

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
  ShieldCheck,
  Truck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { useAdminStore } from '@/store/admin.store';
import { useSession } from '@/lib/hooks/use-session';
import type { Permission } from '@/lib/auth/rbac';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  permission: Permission;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard, permission: 'reports.read' },
  { href: '/admin/inventory', label: 'Inventory', icon: Package, permission: 'inventory.read' },
  { href: '/admin/sales', label: 'Sales History', icon: Receipt, permission: 'sale.read.all' },
  { href: '/admin/purchases', label: 'Purchases', icon: Truck, permission: 'purchase.read' },
  { href: '/admin/staff', label: 'Staff', icon: Users, permission: 'staff.manage' },
  { href: '/admin/reports', label: 'Reports', icon: BarChart3, permission: 'reports.read' },
  { href: '/admin/emi', label: 'EMI Tracker', icon: CreditCard, permission: 'reports.read' },
  { href: '/admin/ai', label: 'AI Insights', icon: Brain, permission: 'ai.read' },
  { href: '/admin/audit', label: 'Audit Log', icon: ShieldCheck, permission: 'audit.read' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { sidebarOpen, toggleSidebar } = useAdminStore();
  const { user, can, logout } = useSession();

  const visibleItems = NAV_ITEMS.filter((item) => can(item.permission));

  return (
    <div className="min-h-screen flex bg-background">
      <aside
        className={cn(
          'fixed left-0 top-0 h-full bg-sidebar text-sidebar-foreground flex flex-col transition-all duration-300 z-50',
          sidebarOpen ? 'w-64' : 'w-[68px]'
        )}
      >
        <div className="h-16 flex items-center px-4 gap-3 shrink-0">
          <div className="w-9 h-9 rounded-lg bg-sidebar-primary flex items-center justify-center shrink-0">
            <Store className="w-5 h-5 text-white" />
          </div>
          {sidebarOpen && (
            <div className="min-w-0">
              <h2 className="font-bold text-sm leading-tight truncate">MaxxCity Mall</h2>
              <p className="text-[10px] text-sidebar-foreground/60">Admin Panel</p>
            </div>
          )}
        </div>

        <Separator className="bg-white/10" />

        <nav className="flex-1 py-3 px-2 space-y-1 overflow-y-auto">
          {visibleItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                title={sidebarOpen ? undefined : item.label}
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

        {sidebarOpen && user && (
          <div className="px-3 py-2.5">
            <p className="text-xs font-medium truncate">{user.name}</p>
            <Badge variant="outline" className="text-[9px] mt-1 border-white/20">
              {user.role}
            </Badge>
          </div>
        )}

        <div className="p-2 space-y-1">
          {can('pos.sell') && (
            <Link
              href="/billing"
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-white/5 transition-all"
            >
              <ShoppingCart className="w-5 h-5 shrink-0" />
              {sidebarOpen && <span>POS Billing</span>}
            </Link>
          )}
          <button
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-sidebar-foreground/70 hover:text-red-400 hover:bg-white/5 transition-all w-full"
            onClick={() => void logout()}
          >
            <LogOut className="w-5 h-5 shrink-0" />
            {sidebarOpen && <span>Sign out</span>}
          </button>
        </div>

        <div className="p-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-center text-sidebar-foreground/50 hover:text-sidebar-foreground"
            onClick={toggleSidebar}
            aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            {sidebarOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </Button>
        </div>
      </aside>

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
