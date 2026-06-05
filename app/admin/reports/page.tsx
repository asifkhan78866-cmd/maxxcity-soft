'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatINR } from '@/lib/gst';
import { Download, FileText, BarChart3, PieChart as PieIcon } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';

const categoryData = [
  { category: 'Electronics', revenue: 32500, qty: 218 },
  { category: 'Home & Kitchen', revenue: 28400, qty: 190 },
  { category: 'Clothing', revenue: 18600, qty: 125 },
  { category: 'Accessories', revenue: 12800, qty: 86 },
  { category: 'Toys', revenue: 10500, qty: 70 },
  { category: 'Stationery', revenue: 8900, qty: 60 },
  { category: 'Personal Care', revenue: 15200, qty: 102 },
];

const paymentData = [
  { name: 'Cash', value: 58, color: '#1B5E20' },
  { name: 'UPI', value: 32, color: '#E8A000' },
  { name: 'Card', value: 10, color: '#2196F3' },
];

const shiftData = [
  { cashier: 'Ravi', shifts: 22, sales: 45600, variance: -120 },
  { cashier: 'Priya', shifts: 18, sales: 38200, variance: 50 },
  { cashier: 'Kumar', shifts: 15, sales: 29800, variance: -340 },
];

const gstReport = [
  { rate: '5%', taxable: 17714, cgst: 443, sgst: 443, total: 886 },
  { rate: '12%', taxable: 53839, cgst: 3230, sgst: 3230, total: 6461 },
  { rate: '18%', taxable: 40508, cgst: 3646, sgst: 3646, total: 7292 },
];

export default function ReportsPage() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Reports & Analytics</h1>
          <p className="text-muted-foreground text-sm">Detailed business reports</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-1.5">
            <Download className="w-4 h-4" />
            Export PDF
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5">
            <FileText className="w-4 h-4" />
            Export CSV
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sales by Category */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="w-4 h-4" />
              Revenue by Category (This Month)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={categoryData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="category" tick={{ fontSize: 11 }} width={100} />
                <Tooltip formatter={(value: any) => [formatINR(value as number), 'Revenue']} />
                <Bar dataKey="revenue" fill="#1B5E20" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Payment Method Split */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <PieIcon className="w-4 h-4" />
              Payment Method Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={paymentData}
                  cx="50%"
                  cy="50%"
                  innerRadius={70}
                  outerRadius={110}
                  paddingAngle={3}
                  dataKey="value"
                  label={({ name, value }) => `${name}: ${value}%`}
                >
                  {paymentData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Legend />
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* GST Report */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">GST Summary (Monthly)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 font-medium">GST Rate</th>
                    <th className="text-right py-2 font-medium">Taxable Value</th>
                    <th className="text-right py-2 font-medium">CGST</th>
                    <th className="text-right py-2 font-medium">SGST</th>
                    <th className="text-right py-2 font-medium">Total Tax</th>
                  </tr>
                </thead>
                <tbody>
                  {gstReport.map((row) => (
                    <tr key={row.rate} className="border-b">
                      <td className="py-2 font-medium">{row.rate}</td>
                      <td className="py-2 text-right">{formatINR(row.taxable)}</td>
                      <td className="py-2 text-right">{formatINR(row.cgst)}</td>
                      <td className="py-2 text-right">{formatINR(row.sgst)}</td>
                      <td className="py-2 text-right font-medium">{formatINR(row.total)}</td>
                    </tr>
                  ))}
                  <tr className="font-bold bg-muted/50">
                    <td className="py-2">Total</td>
                    <td className="py-2 text-right">{formatINR(gstReport.reduce((s, r) => s + r.taxable, 0))}</td>
                    <td className="py-2 text-right">{formatINR(gstReport.reduce((s, r) => s + r.cgst, 0))}</td>
                    <td className="py-2 text-right">{formatINR(gstReport.reduce((s, r) => s + r.sgst, 0))}</td>
                    <td className="py-2 text-right">{formatINR(gstReport.reduce((s, r) => s + r.total, 0))}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Shift Reconciliation */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Shift Reconciliation (This Month)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {shiftData.map((shift) => (
                <div key={shift.cashier} className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border">
                  <div>
                    <p className="font-medium">{shift.cashier}</p>
                    <p className="text-xs text-muted-foreground">{shift.shifts} shifts • {formatINR(shift.sales)} total</p>
                  </div>
                  <div className={`text-sm font-medium ${Math.abs(shift.variance) > 50 ? 'text-destructive' : 'text-emerald-600'}`}>
                    {shift.variance >= 0 ? '+' : ''}{formatINR(shift.variance)} variance
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
