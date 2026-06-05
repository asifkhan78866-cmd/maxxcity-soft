'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatINR } from '@/lib/gst';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
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
} from 'lucide-react';
import { toast } from 'sonner';
import type { EMIStatus } from '@/types';

const STATUS_CONFIG: Record<EMIStatus, { label: string; color: string; icon: React.ComponentType<{ className?: string }> }> = {
  BOOKED: { label: 'Booked', color: 'bg-blue-100 text-blue-700 border-blue-200', icon: Clock },
  SUBMITTED: { label: 'Submitted', color: 'bg-yellow-100 text-yellow-700 border-yellow-200', icon: FileCheck },
  APPROVED: { label: 'Approved', color: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: CheckCircle2 },
  DISBURSED: { label: 'Disbursed', color: 'bg-purple-100 text-purple-700 border-purple-200', icon: Banknote },
  COMMISSION_RECEIVED: { label: 'Commission Received', color: 'bg-green-100 text-green-800 border-green-200', icon: IndianRupee },
};

const CASES = [
  { id: '1', customer_name: 'Ramesh Kumar', customer_phone: '9876543210', product_category: 'Electronics', loan_amount: 25000, finance_partner: 'Bajaj', booking_fee: 149, status: 'APPROVED' as EMIStatus, commission_earned: 1250, created_at: '2025-01-28' },
  { id: '2', customer_name: 'Lakshmi Devi', customer_phone: '9876543211', product_category: 'Home & Kitchen', loan_amount: 18000, finance_partner: 'Snapmint', booking_fee: 149, status: 'DISBURSED' as EMIStatus, commission_earned: 900, created_at: '2025-01-25' },
  { id: '3', customer_name: 'Srinivas Reddy', customer_phone: '9876543212', product_category: 'Electronics', loan_amount: 35000, finance_partner: 'Bajaj', booking_fee: 149, status: 'BOOKED' as EMIStatus, commission_earned: 0, created_at: '2025-01-30' },
  { id: '4', customer_name: 'Anitha Singh', customer_phone: '9876543213', product_category: 'Clothing', loan_amount: 12000, finance_partner: 'HomeCredit', booking_fee: 149, status: 'COMMISSION_RECEIVED' as EMIStatus, commission_earned: 600, created_at: '2025-01-15' },
  { id: '5', customer_name: 'Venkat Rao', customer_phone: '9876543214', product_category: 'Electronics', loan_amount: 28000, finance_partner: 'Bajaj', booking_fee: 149, status: 'SUBMITTED' as EMIStatus, commission_earned: 0, created_at: '2025-01-29' },
];

export default function EMIPage() {
  const [showAdd, setShowAdd] = useState(false);

  const totalLoanAmount = CASES.reduce((s, c) => s + c.loan_amount, 0);
  const totalCommission = CASES.reduce((s, c) => s + c.commission_earned, 0);
  const receivedCommission = CASES.filter((c) => c.status === 'COMMISSION_RECEIVED').reduce((s, c) => s + c.commission_earned, 0);
  const pendingCommission = totalCommission - receivedCommission;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">EMI / Finance Case Tracker</h1>
          <p className="text-muted-foreground text-sm">Bajaj Finance DSA Cases</p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setShowAdd(true)}>
          <Plus className="w-4 h-4" />
          Log New Case
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Total Cases</p>
          <p className="text-2xl font-bold mt-1">{CASES.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Total Loan Volume</p>
          <p className="text-2xl font-bold mt-1">{formatINR(totalLoanAmount)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Commission Earned</p>
          <p className="text-2xl font-bold mt-1 text-primary">{formatINR(totalCommission)}</p>
        </Card>
        <Card className="p-4 border-maxx-gold/30">
          <p className="text-sm text-muted-foreground">Pending Commission</p>
          <p className="text-2xl font-bold mt-1 text-maxx-gold">{formatINR(pendingCommission)}</p>
        </Card>
      </div>

      {/* Status Pipeline */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2">
        {(Object.keys(STATUS_CONFIG) as EMIStatus[]).map((status, i) => {
          const config = STATUS_CONFIG[status];
          const count = CASES.filter((c) => c.status === status).length;
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

      {/* Cases Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {CASES.map((c) => {
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
                    <span className="font-medium">{formatINR(c.loan_amount)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Commission: </span>
                    <span className="font-medium text-primary">{formatINR(c.commission_earned)}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-3 pt-3 border-t">
                  <span className="text-xs text-muted-foreground">
                    {c.product_category} • Booked {c.created_at}
                  </span>
                  {c.status !== 'COMMISSION_RECEIVED' && (
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
                      <TrendingUp className="w-3 h-3" />
                      Advance
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Add Case Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader><DialogTitle>Log New EMI Case</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-4">
            <div><Label>Customer Name</Label><Input placeholder="Full name..." className="mt-1" /></div>
            <div><Label>Phone</Label><Input placeholder="10-digit mobile..." className="mt-1" /></div>
            <div><Label>Product Category</Label><Input placeholder="Electronics..." className="mt-1" /></div>
            <div><Label>Loan Amount (₹)</Label><Input type="number" placeholder="25000" className="mt-1" /></div>
            <div><Label>Finance Partner</Label><Input placeholder="Bajaj / Snapmint / HomeCredit" className="mt-1" /></div>
            <div><Label>Booking Fee (₹)</Label><Input type="number" value="149" readOnly className="mt-1 bg-muted" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={() => { setShowAdd(false); toast.success('EMI case logged!'); }}>Log Case</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
