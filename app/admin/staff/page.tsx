'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Users, Plus, Shield, ShieldCheck, ShieldAlert, Edit, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

const STAFF = [
  { id: '1', name: 'Syed (Owner)', email: 'admin@maxxcity.in', role: 'ADMIN', pin: '0000', active: true, lastActive: '2 min ago' },
  { id: '2', name: 'Priya (Manager)', email: 'priya@maxxcity.in', role: 'MANAGER', pin: '5678', active: true, lastActive: '1 hr ago' },
  { id: '3', name: 'Ravi (Cashier)', email: null, role: 'CASHIER', pin: '1234', active: true, lastActive: '5 min ago' },
  { id: '4', name: 'Kumar (Cashier)', email: null, role: 'CASHIER', pin: '4321', active: false, lastActive: '2 days ago' },
];

const roleIcons = { ADMIN: ShieldAlert, MANAGER: ShieldCheck, CASHIER: Shield };
const roleColors = { ADMIN: 'destructive' as const, MANAGER: 'default' as const, CASHIER: 'secondary' as const };

export default function StaffPage() {
  const [showAdd, setShowAdd] = useState(false);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Staff Management</h1>
          <p className="text-muted-foreground text-sm">{STAFF.length} team members</p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setShowAdd(true)}>
          <Plus className="w-4 h-4" />
          Add Staff
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {(['ADMIN', 'MANAGER', 'CASHIER'] as const).map((role) => {
          const count = STAFF.filter((s) => s.role === role).length;
          const Icon = roleIcons[role];
          return (
            <Card key={role} className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Icon className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{count}</p>
                  <p className="text-sm text-muted-foreground">{role}s</p>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>PIN</TableHead>
              <TableHead className="text-center">Status</TableHead>
              <TableHead>Last Active</TableHead>
              <TableHead className="text-center">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {STAFF.map((member) => (
              <TableRow key={member.id}>
                <TableCell className="font-medium">{member.name}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{member.email || '—'}</TableCell>
                <TableCell>
                  <Badge variant={roleColors[member.role as keyof typeof roleColors]}>{member.role}</Badge>
                </TableCell>
                <TableCell className="font-mono text-sm">{member.pin}</TableCell>
                <TableCell className="text-center">
                  <Badge variant={member.active ? 'default' : 'secondary'}>
                    {member.active ? 'Active' : 'Inactive'}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{member.lastActive}</TableCell>
                <TableCell className="text-center">
                  <div className="flex justify-center gap-1">
                    <Button size="sm" variant="ghost" className="h-7 px-2"><Edit className="w-3.5 h-3.5" /></Button>
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive"><Trash2 className="w-3.5 h-3.5" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Staff Member</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-4">
            <div className="col-span-2"><Label>Full Name</Label><Input placeholder="Enter name..." className="mt-1" /></div>
            <div><Label>Email (optional)</Label><Input type="email" placeholder="email@maxxcity.in" className="mt-1" /></div>
            <div><Label>Role</Label><Input placeholder="CASHIER / MANAGER / ADMIN" className="mt-1" /></div>
            <div><Label>4-Digit PIN</Label><Input type="password" maxLength={4} placeholder="••••" className="mt-1" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={() => { setShowAdd(false); toast.success('Staff member added!'); }}>Add Member</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
