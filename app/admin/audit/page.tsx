'use client';

// ═══════════════════════════════════════
// Audit Log
// ═══════════════════════════════════════
// Who did what, when, to which entity. Sensitive operations — logins, sales,
// voids, returns, stock adjustments, staff changes, shift open/close and
// settings edits — all land here.

import { useState, useCallback, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, ChevronLeft, ChevronRight, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api-client';
import { useAsyncData } from '@/lib/hooks/use-async-data';

interface AuditEntry {
  id: string;
  user_id: string | null;
  user_name: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  profiles?: { name?: string; role?: string } | null;
}

const ACTIONS = [
  'all',
  'LOGIN_SUCCESS',
  'LOGIN_FAILED',
  'LOGOUT',
  'SALE_COMPLETED',
  'SALE_VOIDED',
  'RETURN_PROCESSED',
  'DISCOUNT_APPLIED',
  'STOCK_ADJUSTED',
  'PRODUCT_CREATED',
  'PRODUCT_UPDATED',
  'STAFF_CREATED',
  'STAFF_UPDATED',
  'SHIFT_OPENED',
  'SHIFT_CLOSED',
  'SETTINGS_UPDATED',
  'PURCHASE_RECEIVED',
  'RECEIPT_REPRINTED',
  'OFFLINE_SALE_SYNCED',
  'DATABASE_SEEDED',
];

/** Actions that warrant visual emphasis when scanning the log. */
const HIGH_ATTENTION = new Set([
  'SALE_VOIDED',
  'LOGIN_FAILED',
  'DISCOUNT_APPLIED',
  'STAFF_DEACTIVATED',
  'DATABASE_SEEDED',
]);

const PAGE_SIZE = 100;

export default function AuditPage() {
  const [action, setAction] = useState('all');
  const [page, setPage] = useState(1);

  const fetchEntries = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
    if (action !== 'all') params.set('action', action);
    return api.get<{ entries: AuditEntry[]; pagination: { total: number } }>(
      `/api/activity?${params.toString()}`
    );
  }, [action, page]);

  const { data, error, loading } = useAsyncData(fetchEntries);

  const entries = useMemo(() => data?.entries ?? [], [data]);
  const total = data?.pagination.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Changing the filter resets to the first page; doing it in the handler
  // rather than an effect avoids a wasted fetch of page N under the new filter.
  const changeAction = (value: string) => {
    setAction(value);
    setPage(1);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-primary" /> Audit Log
          </h1>
          <p className="text-muted-foreground text-sm">
            {loading ? 'Loading…' : `${total} recorded action(s)`}
          </p>
        </div>
        <Select value={action} onValueChange={(v) => changeAction(v ?? 'all')}>
          <SelectTrigger className="w-[240px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ACTIONS.map((a) => (
              <SelectItem key={a} value={a}>
                {a === 'all' ? 'All actions' : a.replace(/_/g, ' ')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <p className="text-center text-sm text-destructive py-16">{error}</p>
        ) : entries.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-16">
            No matching activity recorded.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[160px]">When</TableHead>
                <TableHead className="w-[150px]">Who</TableHead>
                <TableHead className="w-[190px]">Action</TableHead>
                <TableHead className="w-[110px]">Entity</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow
                  key={entry.id}
                  className={HIGH_ATTENTION.has(entry.action) ? 'bg-destructive/5' : ''}
                >
                  <TableCell className="text-xs whitespace-nowrap">
                    {new Date(entry.created_at).toLocaleString('en-IN', {
                      dateStyle: 'short',
                      timeStyle: 'medium',
                    })}
                  </TableCell>
                  <TableCell className="text-sm">
                    {entry.profiles?.name ?? entry.user_name ?? 'System / anonymous'}
                    {entry.profiles?.role && (
                      <Badge variant="outline" className="ml-1.5 text-[9px]">
                        {entry.profiles.role}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={HIGH_ATTENTION.has(entry.action) ? 'destructive' : 'secondary'}
                      className="text-[10px] font-mono"
                    >
                      {entry.action}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {entry.entity_type ?? '—'}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {entry.details ?? '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft className="w-4 h-4" /> Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
