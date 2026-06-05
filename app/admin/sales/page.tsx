'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatINR } from '@/lib/gst';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Search, Download, Receipt, Eye, Ban } from 'lucide-react';

const SALES = Array.from({ length: 20 }, (_, i) => {
  const d = new Date();
  d.setHours(d.getHours() - i * 3);
  const methods = ['CASH', 'UPI', 'CARD'] as const;
  const items = Math.floor(Math.random() * 6) + 1;
  return {
    id: `sale-${i + 1}`,
    invoice: `MCM/2025/${String(1000 + i).padStart(6, '0')}`,
    cashier: i % 3 === 0 ? 'Syed' : i % 2 === 0 ? 'Priya' : 'Ravi',
    items,
    total: items * 149,
    method: methods[i % 3],
    status: i === 5 ? 'VOID' : 'COMPLETED',
    date: d.toLocaleDateString('en-IN'),
    time: d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
  };
});

export default function SalesPage() {
  const [search, setSearch] = useState('');

  const filtered = SALES.filter(
    (s) => !search || s.invoice.includes(search) || s.cashier.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Sales History</h1>
          <p className="text-muted-foreground text-sm">{SALES.length} transactions</p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Download className="w-4 h-4" />
          Export CSV
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search by invoice or cashier..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Time</TableHead>
              <TableHead>Cashier</TableHead>
              <TableHead className="text-center">Items</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-center">Payment</TableHead>
              <TableHead className="text-center">Status</TableHead>
              <TableHead className="text-center">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((sale) => (
              <TableRow key={sale.id} className={sale.status === 'VOID' ? 'opacity-50' : ''}>
                <TableCell className="font-mono text-xs">{sale.invoice}</TableCell>
                <TableCell className="text-sm">{sale.date}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{sale.time}</TableCell>
                <TableCell className="text-sm">{sale.cashier}</TableCell>
                <TableCell className="text-center">{sale.items}</TableCell>
                <TableCell className="text-right font-medium">{formatINR(sale.total)}</TableCell>
                <TableCell className="text-center">
                  <Badge variant="outline" className="text-xs">{sale.method}</Badge>
                </TableCell>
                <TableCell className="text-center">
                  <Badge variant={sale.status === 'VOID' ? 'destructive' : 'default'} className="text-xs">
                    {sale.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-center">
                  <div className="flex justify-center gap-1">
                    <Button size="sm" variant="ghost" className="h-7 px-2">
                      <Eye className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 px-2">
                      <Receipt className="w-3.5 h-3.5" />
                    </Button>
                    {sale.status !== 'VOID' && (
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive">
                        <Ban className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
