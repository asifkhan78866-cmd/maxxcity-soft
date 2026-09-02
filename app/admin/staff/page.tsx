'use client';

// ═══════════════════════════════════════
// Staff Management
// ═══════════════════════════════════════
// PINs are stored as PBKDF2 hashes and are NEVER displayed. The table shows
// only whether a PIN is set — there is no API anywhere that can return one.
// To give someone access again, set a new PIN; it cannot be looked up.

import { useState, useCallback, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
  Plus,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Edit,
  KeyRound,
  Loader2,
  Lock,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiClientError } from '@/lib/api-client';
import { useAsyncData } from '@/lib/hooks/use-async-data';
import type { StaffSummary, UserRole } from '@/types';

const ROLE_ICONS = { ADMIN: ShieldAlert, MANAGER: ShieldCheck, CASHIER: Shield };
const ROLE_VARIANTS: Record<UserRole, 'destructive' | 'default' | 'secondary'> = {
  ADMIN: 'destructive',
  MANAGER: 'default',
  CASHIER: 'secondary',
};

const emptyForm = {
  name: '',
  email: '',
  phone: '',
  role: 'CASHIER' as UserRole,
  staff_code: '',
  pin: '',
  password: '',
};

export default function StaffPage() {
  const fetchStaff = useCallback(() => api.get<StaffSummary[]>('/api/staff'), []);
  const { data, error: loadError, loading, refresh } = useAsyncData(fetchStaff);
  const staff = useMemo(() => data ?? [], [data]);

  const [busy, setBusy] = useState(false);

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const [editTarget, setEditTarget] = useState<StaffSummary | null>(null);
  const [editForm, setEditForm] = useState({ name: '', role: 'CASHIER' as UserRole, phone: '' });

  const [resetTarget, setResetTarget] = useState<StaffSummary | null>(null);
  const [newPin, setNewPin] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const handleAdd = async () => {
    setBusy(true);
    try {
      await api.post('/api/staff', {
        name: form.name,
        email: form.email || null,
        phone: form.phone || null,
        role: form.role,
        staff_code: form.staff_code,
        pin: form.pin || null,
        password: form.password || null,
        is_active: true,
      });
      toast.success(`${form.name} added. Give them their staff code and PIN in person.`);
      setShowAdd(false);
      setForm(emptyForm);
      refresh();
    } catch (error) {
      toast.error((error as ApiClientError).message);
    } finally {
      setBusy(false);
    }
  };

  const handleEdit = async () => {
    if (!editTarget) return;
    setBusy(true);
    try {
      await api.patch(`/api/staff/${editTarget.id}`, {
        name: editForm.name,
        role: editForm.role,
        phone: editForm.phone || null,
      });
      toast.success(`${editForm.name} updated`);
      setEditTarget(null);
      refresh();
    } catch (error) {
      toast.error((error as ApiClientError).message);
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    if (!resetTarget) return;
    if (!newPin && !newPassword) {
      toast.error('Enter a new PIN or password');
      return;
    }
    setBusy(true);
    try {
      await api.patch(`/api/staff/${resetTarget.id}`, {
        pin: newPin || undefined,
        password: newPassword || undefined,
      });
      toast.success(
        `Credentials updated for ${resetTarget.name}. Tell them the new PIN directly — it cannot be looked up later.`,
        { duration: 8000 }
      );
      setResetTarget(null);
      setNewPin('');
      setNewPassword('');
      refresh();
    } catch (error) {
      toast.error((error as ApiClientError).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (member: StaffSummary) => {
    try {
      await api.patch(`/api/staff/${member.id}`, { is_active: !member.is_active });
      toast.success(`${member.name} ${member.is_active ? 'deactivated' : 'reactivated'}`);
      refresh();
    } catch (error) {
      toast.error((error as ApiClientError).message);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Staff Management</h1>
          <p className="text-muted-foreground text-sm">
            {loading ? 'Loading…' : `${staff.length} team member(s)`}
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setShowAdd(true)}>
          <Plus className="w-4 h-4" /> Add Staff
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {(['ADMIN', 'MANAGER', 'CASHIER'] as const).map((role) => {
          const count = staff.filter((s) => s.role === role && s.is_active).length;
          const Icon = ROLE_ICONS[role];
          return (
            <Card key={role} className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Icon className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{count}</p>
                  <p className="text-sm text-muted-foreground">active {role.toLowerCase()}s</p>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <Card>
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : loadError ? (
          <p className="text-center text-sm text-destructive py-16">{loadError}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Staff code</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-center">Credentials</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead>Last sign-in</TableHead>
                <TableHead className="text-center">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {staff.map((member) => (
                <TableRow key={member.id} className={member.is_active ? '' : 'opacity-50'}>
                  <TableCell className="font-medium">{member.name}</TableCell>
                  <TableCell className="font-mono text-sm">{member.staff_code ?? '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {member.email ?? '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={ROLE_VARIANTS[member.role]}>{member.role}</Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    {/* Never the PIN itself — only whether one exists. */}
                    <div className="flex gap-1 justify-center">
                      {member.hasPin && (
                        <Badge variant="outline" className="text-[10px]">
                          PIN set
                        </Badge>
                      )}
                      {member.hasPassword && (
                        <Badge variant="outline" className="text-[10px]">
                          Password set
                        </Badge>
                      )}
                      {!member.hasPin && !member.hasPassword && (
                        <span className="text-xs text-destructive">None</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    {member.isLocked ? (
                      <Badge variant="destructive" className="gap-1 text-[10px]">
                        <Lock className="w-3 h-3" /> Locked
                      </Badge>
                    ) : (
                      <Badge variant={member.is_active ? 'default' : 'secondary'}>
                        {member.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {member.last_login_at
                      ? new Date(member.last_login_at).toLocaleString('en-IN', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })
                      : 'Never'}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2"
                        title="Edit"
                        onClick={() => {
                          setEditTarget(member);
                          setEditForm({
                            name: member.name,
                            role: member.role,
                            phone: member.phone ?? '',
                          });
                        }}
                      >
                        <Edit className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2"
                        title="Reset PIN / password"
                        onClick={() => {
                          setResetTarget(member);
                          setNewPin('');
                          setNewPassword('');
                        }}
                      >
                        <KeyRound className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() => void toggleActive(member)}
                      >
                        {member.is_active ? 'Disable' : 'Enable'}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* ─── Add ─── */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Staff Member</DialogTitle>
            <DialogDescription>
              The PIN is hashed immediately and cannot be retrieved afterwards. Note it down and
              hand it over in person.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="col-span-2">
              <Label htmlFor="s-name">Full name *</Label>
              <Input
                id="s-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="s-code">Staff code *</Label>
              <Input
                id="s-code"
                value={form.staff_code}
                onChange={(e) => setForm({ ...form, staff_code: e.target.value.toUpperCase() })}
                placeholder="RAVI01"
                className="mt-1 font-mono"
              />
            </div>
            <div>
              <Label htmlFor="s-role">Role *</Label>
              <Select
                value={form.role}
                onValueChange={(v) => setForm({ ...form, role: (v ?? 'CASHIER') as UserRole })}
              >
                <SelectTrigger id="s-role" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CASHIER">Cashier</SelectItem>
                  <SelectItem value="MANAGER">Manager</SelectItem>
                  <SelectItem value="ADMIN">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="s-email">Email (for password login)</Label>
              <Input
                id="s-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="s-phone">Phone</Label>
              <Input
                id="s-phone"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="s-pin">4–6 digit PIN</Label>
              <Input
                id="s-pin"
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={form.pin}
                onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, '') })}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="s-password">Password (optional)</Label>
              <Input
                id="s-password"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="Min 8 characters"
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleAdd()}
              disabled={busy || !form.name || !form.staff_code || (!form.pin && !form.password)}
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Add Member'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Edit ─── */}
      <Dialog open={!!editTarget} onOpenChange={() => setEditTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit {editTarget?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="e-name">Name</Label>
              <Input
                id="e-name"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="e-role">Role</Label>
              <Select
                value={editForm.role}
                onValueChange={(v) => setEditForm({ ...editForm, role: (v ?? 'CASHIER') as UserRole })}
              >
                <SelectTrigger id="e-role" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CASHIER">Cashier</SelectItem>
                  <SelectItem value="MANAGER">Manager</SelectItem>
                  <SelectItem value="ADMIN">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="e-phone">Phone</Label>
              <Input
                id="e-phone"
                value={editForm.phone}
                onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>
              Cancel
            </Button>
            <Button onClick={() => void handleEdit()} disabled={busy}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Reset credentials ─── */}
      <Dialog open={!!resetTarget} onOpenChange={() => setResetTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reset credentials — {resetTarget?.name}</DialogTitle>
            <DialogDescription>
              The existing PIN cannot be shown to anyone, including you. Setting a new one also
              clears any lockout.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="r-pin">New PIN</Label>
              <Input
                id="r-pin"
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="r-password">New password</Label>
              <Input
                id="r-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Min 8 characters"
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetTarget(null)}>
              Cancel
            </Button>
            <Button onClick={() => void handleReset()} disabled={busy}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Update Credentials'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
