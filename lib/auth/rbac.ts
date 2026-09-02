// ═══════════════════════════════════════
// Role-Based Access Control
// ═══════════════════════════════════════
// A single capability matrix drives BOTH the server-side API guards and the
// UI. The server is authoritative: hiding a nav link is a convenience, the
// permission check in the route handler is the control.

import type { UserRole } from '@/types';

export type Permission =
  // POS
  | 'pos.sell'
  | 'pos.hold'
  | 'pos.reprint'
  // Sales lifecycle
  | 'sale.read.own'
  | 'sale.read.all'
  | 'sale.void'
  | 'sale.return'
  | 'sale.invoice.formal'
  // Discounts
  | 'discount.apply'
  | 'discount.override'
  // Inventory
  | 'inventory.read'
  | 'inventory.adjust'
  | 'product.create'
  | 'product.update'
  | 'product.deactivate'
  // Procurement
  | 'purchase.read'
  | 'purchase.manage'
  | 'purchase.receive'
  // Customers
  | 'customer.read'
  | 'customer.manage'
  // Shifts
  | 'shift.open'
  | 'shift.close'
  | 'shift.read.own'
  | 'shift.read.all'
  // Staff
  | 'staff.read'
  | 'staff.manage'
  // Reporting & audit
  | 'reports.read'
  | 'audit.read'
  | 'ai.read'
  // Settings / dangerous
  | 'settings.write'
  | 'database.seed';

const CASHIER_PERMISSIONS: Permission[] = [
  'pos.sell',
  'pos.hold',
  'pos.reprint',
  'sale.read.own',
  'customer.read',
  'customer.manage',
  'inventory.read',
  'shift.open',
  'shift.close',
  'shift.read.own',
];

const MANAGER_PERMISSIONS: Permission[] = [
  ...CASHIER_PERMISSIONS,
  'sale.read.all',
  'sale.void',
  'sale.return',
  'sale.invoice.formal',
  'discount.apply',
  'inventory.adjust',
  'product.create',
  'product.update',
  'purchase.read',
  'purchase.manage',
  'purchase.receive',
  'shift.read.all',
  'staff.read',
  'reports.read',
  'ai.read',
];

const ADMIN_PERMISSIONS: Permission[] = [
  ...MANAGER_PERMISSIONS,
  'discount.override',
  'product.deactivate',
  'staff.manage',
  'audit.read',
  'settings.write',
  'database.seed',
];

export const ROLE_PERMISSIONS: Record<UserRole, ReadonlySet<Permission>> = {
  CASHIER: new Set(CASHIER_PERMISSIONS),
  MANAGER: new Set(MANAGER_PERMISSIONS),
  ADMIN: new Set(ADMIN_PERMISSIONS),
};

export function hasPermission(role: UserRole | undefined | null, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

export function hasAnyPermission(role: UserRole | undefined | null, permissions: Permission[]): boolean {
  return permissions.some((p) => hasPermission(role, p));
}

/**
 * Maximum discount a role may apply, as a fraction of the bill.
 *
 * A cashier cannot discount at all; a manager is capped; an admin may
 * override. Every non-zero discount is written to the activity log.
 */
export const MAX_DISCOUNT_FRACTION: Record<UserRole, number> = {
  CASHIER: 0,
  MANAGER: 0.1,
  ADMIN: 1,
};

/** Absolute cap in rupees, applied alongside the fractional cap. */
export const MAX_DISCOUNT_ABSOLUTE: Record<UserRole, number> = {
  CASHIER: 0,
  MANAGER: 500,
  ADMIN: Number.POSITIVE_INFINITY,
};

export function maxDiscountFor(role: UserRole, billTotal: number): number {
  const byFraction = billTotal * MAX_DISCOUNT_FRACTION[role];
  return Math.min(byFraction, MAX_DISCOUNT_ABSOLUTE[role]);
}

// ─── Route-level page access (used by proxy.ts and the admin nav) ───

export interface RouteRule {
  prefix: string;
  roles: UserRole[];
}

/**
 * Page prefixes and the roles allowed to load them.
 * Order matters — the first matching prefix wins, so list specific paths
 * before their parents.
 */
export const ROUTE_RULES: RouteRule[] = [
  { prefix: '/billing', roles: ['CASHIER', 'MANAGER', 'ADMIN'] },
  { prefix: '/admin/inventory', roles: ['MANAGER', 'ADMIN'] },
  { prefix: '/admin/reports', roles: ['MANAGER', 'ADMIN'] },
  { prefix: '/admin/sales', roles: ['MANAGER', 'ADMIN'] },
  { prefix: '/admin/purchases', roles: ['MANAGER', 'ADMIN'] },
  { prefix: '/admin/dashboard', roles: ['MANAGER', 'ADMIN'] },
  { prefix: '/admin/ai', roles: ['MANAGER', 'ADMIN'] },
  { prefix: '/admin/staff', roles: ['ADMIN'] },
  { prefix: '/admin/emi', roles: ['ADMIN'] },
  { prefix: '/admin/audit', roles: ['ADMIN'] },
  { prefix: '/admin', roles: ['ADMIN'] },
];

export function canAccessRoute(role: UserRole, pathname: string): boolean {
  const rule = ROUTE_RULES.find((r) => pathname === r.prefix || pathname.startsWith(r.prefix + '/'));
  if (!rule) return true; // Not a guarded area — authentication alone is enough.
  return rule.roles.includes(role);
}

/** Where to send a user who lacks access to the page they requested. */
export function landingRouteFor(role: UserRole): string {
  return role === 'CASHIER' ? '/billing' : '/admin/dashboard';
}
