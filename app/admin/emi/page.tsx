'use client';

// ═══════════════════════════════════════
// EMI / Finance Case Tracker
// ═══════════════════════════════════════
// Real database rows. The booking fee is an INDEPENDENT configured value
// (EMI_BOOKING_FEE) — it is deliberately not tied to the ₹99 product selling
// price, so a pricing change can never silently alter it.

import { useState, useCallback, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  CreditCard,
  Plus,
  ArrowRight,
  Phone,
  User,
  IndianRupee,
  TrendingUp,
  CheckCircle2,
  Clock,
  FileCheck,
  Banknote,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatINR } from '@/lib/money';
import { api, ApiClientError } from '@/lib/api-client';
import { useAsyncData } from '@/lib/hooks/use-async-data';
import type { EMICase, EMIStatus, FinancePartner } from '@/types';

const STATUS_CONFIG: Record<
  EMIStatus,
  { label: string; color: string; icon: React.ComponentType<{ className?: string }> }
> = {
  BOOKED: { label: 'Booked', color: 'bg-blue-100 text-blue-700 border-blue-200', icon: Clock },
  SUBMITTED: {
    label: 'Submitted',
    color: 'bg-yellow-100 text-yellow-700 border-yellow-200',
    icon: FileCheck,
  },
  APPROVED: {
    label: 'Approved',
    color: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    icon: CheckCircle2,
  },
  DISBURSED: {
    label: 'Disbursed',
    color: 'bg-purple-100 text-purple-700 border-purple-200',
    icon: Banknote,
  },
  COMMISSION_RECEIVED: {
    label: 'Commission Received',
    color: 'bg-green-100 text-green-800 border-green-200',
    icon: IndianRupee,
  },
};

const NEXT_STATUS: Record<EMIStatus, EMIStatus | null> = {
  BOOKED: 'SUBMITTED',
  SUBMITTED: 'APPROVED',
  APPROVED: 'DISBURSED',
  DISBURSED: 'COMMISSION_RECEIVED',
  COMMISSION_RECEIVED: null,
};

export default function EMIPage() {
  const fetchCases = useCallback(
    () => api.get<{ cases: EMICase[]; bookingFee: number }>('/api/emi'),
    []
  );
  const { data, loading, refresh } = useAsyncData(fetchCases);
  const cases = useMemo(() => data?.cases ?? [], [data]);
  const bookingFee = data?.bookingFee ?? 0;

  const [busy, setBusy] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  const [form, setForm] = useState({
    customer_name: '',
    customer_phone: '',
    product_category: '',
    loan_amount: '',
    finance_partner: 'Bajaj' as FinancePartner,
  });

  const totalLoanAmount = cases.reduce((s, c) => s + Number(c.loan_amount), 0);
  const totalCommission = cases.reduce((s, c) => s + Number(c.commission_earned), 0);
  const receivedCommission = cases
    .filter((c) => c.commission_received)
    .reduce((s, c) => s + Number(c.commission_earned), 0);
  const pendingCommission = totalCommission - receivedCommission;

  const handleAdd = async () => {
    setBusy(true);
    try {
      await api.post('/api/emi', {
        customer_name: form.customer_name,
        customer_phone: form.customer_phone,
        product_category: form.product_category,
        loan_amount: Number(form.loan_amount),
        finance_partner: form.finance_partner,
      });
      toast.success('EMI case logged');
      setShowAdd(false);
      setForm({
        customer_name: '',
        customer_phone: '',
        product_category: '',
        loan_amount: '',
        finance_partner: 'Bajaj',
      });
      refresh();
    } catch (error) {
      toast.error((error as ApiClientError).message);
    } finally {
      setBusy(false);
    }
  };

  const advance = async (emiCase: EMICase) => {
    const next = NEXT_STATUS[emiCase.status];
    if (!next) return;
    try {
      await api.patch('/api/emi', {
        id: emiCase.id,
        status: next,
        commission_received: next === 'COMMISSION_RECEIVED' ? true : undefined,
      });
      toast.success(`Moved to ${STATUS_CONFIG[next].label}`);
      refresh();
    } catch (error) {
      toast.error((error as ApiClientError).message);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">EMI / Finance Case Tracker</h1>
          <p className="text-muted-foreground text-sm">
            Booking fee: {formatINR(bookingFee)} — configured independently of product pricing
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setShowAdd(true)}>
          <Plus className="w-4 h-4" /> Log New Case
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Total Cases</p>
          <p className="text-2xl font-bold mt-1">{cases.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Loan Volume</p>
          <p className="text-2xl font-bold mt-1">{formatINR(totalLoanAmount)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Commission Earned</p>
          <p className="text-2xl font-bold mt-1 text-primary">{formatINR(totalCommission)}</p>
        </Card>
        <Card className="p-4 border-maxx-gold/30">
          <p className="text-sm text-muted-foreground">Pending Commission</p>
          <p className="text-2xl font-bold mt-1 text-maxx-gold">
            {formatINR(pendingCommission)}
          </p>
        </Card>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-2">
        {(Object.keys(STATUS_CONFIG) as EMIStatus[]).map((status, i) => {
          const config = STATUS_CONFIG[status];
          const count = cases.filter((c) => c.status === status).length;
          return (
            <div key={status} className="flex items-center gap-2">
              <div className={`px-4 py-2 rounded-lg border ${config.color} text-center min-w-[120px]`}>
                <p className="text-lg font-bold">{count}</p>
                <p className="text-xs">{config.label}</p>
              </div>
              {i < Object.keys(STATUS_CONFIG).length - 1 && (
                <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
              )}
            </div>
          );
        })}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : cases.length === 0 ? (
        <Card className="p-12 text-center text-sm text-muted-foreground">
          No finance cases logged yet.
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {cases.map((c) => {
            const config = STATUS_CONFIG[c.status];
            const StatusIcon = config.icon;
            return (
              <Card key={c.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <User className="w-4 h-4 text-muted-foreground" />
                      <span className="font-semibold">{c.customer_name}</span>
                    </div>
                    <Badge className={`${config.color} border gap-1`}>
                      <StatusIcon className="w-3 h-3" />
                      {config.label}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Phone className="w-3.5 h-3.5" />
                      {c.customer_phone}
                    </div>
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <CreditCard className="w-3.5 h-3.5" />
                      {c.finance_partner}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Loan: </span>
                      <span className="font-medium">{formatINR(Number(c.loan_amount))}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Commission: </span>
                      <span className="font-medium text-primary">
                        {formatINR(Number(c.commission_earned))}
                      </span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-muted-foreground">Booking fee: </span>
                      <span className="font-medium">{formatINR(Number(c.booking_fee))}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-3 pt-3 border-t">
                    <span className="text-xs text-muted-foreground">
                      {c.product_category} · booked{' '}
                      {new Date(c.created_at).toLocaleDateString('en-IN')}
                    </span>
                    {NEXT_STATUS[c.status] && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1"
                        onClick={() => void advance(c)}
                      >
                        <TrendingUp className="w-3 h-3" />
                        {STATUS_CONFIG[NEXT_STATUS[c.status]!].label}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Log New EMI Case</DialogTitle>
            <DialogDescription>
              The booking fee of {formatINR(bookingFee)} is applied automatically from the
              finance configuration.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div>
              <Label htmlFor="c-name">Customer name *</Label>
              <Input
                id="c-name"
                value={form.customer_name}
                onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="c-phone">Phone *</Label>
              <Input
                id="c-phone"
                maxLength={10}
                inputMode="numeric"
                value={form.customer_phone}
                onChange={(e) =>
                  setForm({ ...form, customer_phone: e.target.value.replace(/\D/g, '') })
                }
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="c-category">Product category *</Label>
              <Input
                id="c-category"
                value={form.product_category}
                onChange={(e) => setForm({ ...form, product_category: e.target.value })}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="c-loan">Loan amount (₹) *</Label>
              <Input
                id="c-loan"
                type="number"
                value={form.loan_amount}
                onChange={(e) => setForm({ ...form, loan_amount: e.target.value })}
                className="mt-1"
              />
            </div>
            <div className="col-span-2">
              <Label htmlFor="c-partner">Finance partner *</Label>
              <Select
                value={form.finance_partner}
                onValueChange={(v) => setForm({ ...form, finance_partner: (v ?? 'Bajaj') as FinancePartner })}
              >
                <SelectTrigger id="c-partner" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Bajaj">Bajaj</SelectItem>
                  <SelectItem value="Snapmint">Snapmint</SelectItem>
                  <SelectItem value="HomeCredit">HomeCredit</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleAdd()}
              disabled={
                busy ||
                !form.customer_name ||
                form.customer_phone.length !== 10 ||
                !form.loan_amount
              }
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Log Case'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
