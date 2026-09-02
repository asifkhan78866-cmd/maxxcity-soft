'use client';

// ═══════════════════════════════════════
// Sign In
// ═══════════════════════════════════════
// Two real paths, both verified server-side against hashed credentials:
//
//   PIN login   — staff code + PIN, for cashiers at the counter
//   Email login — email + password, for managers and the owner
//
// There are no demo credentials on this screen and none in the codebase. The
// session is set as an httpOnly, signed cookie by the API; nothing sensitive
// is written to document.cookie or to localStorage.

import { useState, useRef, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { api, ApiClientError } from '@/lib/api-client';
import { Store, KeyRound, Mail, Lock, ShieldCheck, Loader2, Delete, User } from 'lucide-react';

interface LoginResult {
  user: { id: string; name: string; role: string };
  redirectTo: string;
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectParam = searchParams.get('redirect');

  const [activeTab, setActiveTab] = useState<'pin' | 'email'>('pin');

  const [staffCode, setStaffCode] = useState('');
  const [pin, setPin] = useState('');
  const [pinLoading, setPinLoading] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);

  const staffCodeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (activeTab === 'pin') staffCodeRef.current?.focus();
  }, [activeTab]);

  /**
   * Only follow a redirect that is a path on this origin. Accepting an
   * arbitrary `redirect` value would be an open-redirect.
   */
  function safeRedirect(fallback: string): string {
    if (redirectParam && redirectParam.startsWith('/') && !redirectParam.startsWith('//')) {
      return redirectParam;
    }
    return fallback;
  }

  const submitPin = async (pinValue: string) => {
    if (!staffCode.trim()) {
      toast.error('Enter your staff code');
      staffCodeRef.current?.focus();
      return;
    }
    if (pinValue.length < 4) {
      toast.error('Enter your PIN');
      return;
    }

    setPinLoading(true);
    try {
      const result = await api.post<LoginResult>('/api/auth/pin-login', {
        staffCode: staffCode.trim(),
        pin: pinValue,
      });
      toast.success(`Welcome, ${result.user.name}`);
      router.push(safeRedirect(result.redirectTo));
      router.refresh();
    } catch (error) {
      const err = error as ApiClientError;
      toast.error(err.message, { duration: err.code === 'ACCOUNT_LOCKED' ? 10000 : 5000 });
      setPin('');
    } finally {
      setPinLoading(false);
    }
  };

  const submitEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailLoading(true);
    try {
      const result = await api.post<LoginResult>('/api/auth/email-login', { email, password });
      toast.success(`Welcome back, ${result.user.name}`);
      router.push(safeRedirect(result.redirectTo));
      router.refresh();
    } catch (error) {
      toast.error((error as ApiClientError).message);
      setPassword('');
    } finally {
      setEmailLoading(false);
    }
  };

  const pressDigit = (digit: string) => {
    if (pin.length >= 6) return;
    setPin((prev) => prev + digit);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-maxx-green-dark via-maxx-green to-maxx-green-light p-4">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-maxx-gold/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-maxx-gold/10 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-white/10 backdrop-blur-xl border border-white/20 mb-4 shadow-2xl">
            <Store className="w-10 h-10 text-maxx-gold" />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">MaxxCity Mall</h1>
          <p className="text-white/70 mt-1 text-sm">Billing &amp; Management System</p>
        </div>

        <Card className="glass-card border-white/20 shadow-2xl">
          <CardHeader className="pb-4">
            <CardTitle className="text-center text-lg">Sign In</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'pin' | 'email')}>
              <TabsList className="grid w-full grid-cols-2 mb-6">
                <TabsTrigger value="pin" className="gap-2">
                  <KeyRound className="w-4 h-4" /> Staff PIN
                </TabsTrigger>
                <TabsTrigger value="email" className="gap-2">
                  <Mail className="w-4 h-4" /> Email
                </TabsTrigger>
              </TabsList>

              {/* ─── PIN ─── */}
              <TabsContent value="pin" className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="staff-code">Staff Code</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="staff-code"
                      ref={staffCodeRef}
                      value={staffCode}
                      onChange={(e) => setStaffCode(e.target.value.toUpperCase())}
                      placeholder="e.g. RAVI01"
                      maxLength={16}
                      className="pl-10 font-mono font-semibold"
                      autoComplete="username"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="pin-input">PIN</Label>
                  <Input
                    id="pin-input"
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void submitPin(pin);
                    }}
                    placeholder="••••"
                    className="text-center text-2xl tracking-[0.5em] font-bold h-14"
                    autoComplete="current-password"
                  />
                </div>

                <div className="grid grid-cols-3 gap-2 max-w-[260px] mx-auto">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                    <Button
                      key={d}
                      type="button"
                      variant="outline"
                      className="h-13 py-3 text-xl font-semibold hover:bg-primary hover:text-primary-foreground"
                      onClick={() => pressDigit(d)}
                      disabled={pinLoading}
                    >
                      {d}
                    </Button>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    className="py-3"
                    onClick={() => setPin((p) => p.slice(0, -1))}
                    disabled={pinLoading}
                    aria-label="Delete last digit"
                  >
                    <Delete className="w-5 h-5" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="py-3 text-xl font-semibold hover:bg-primary hover:text-primary-foreground"
                    onClick={() => pressDigit('0')}
                    disabled={pinLoading}
                  >
                    0
                  </Button>
                  <Button
                    type="button"
                    className="py-3 bg-primary hover:bg-primary/90"
                    onClick={() => void submitPin(pin)}
                    disabled={pinLoading || pin.length < 4 || !staffCode}
                    aria-label="Sign in"
                  >
                    {pinLoading ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <ShieldCheck className="w-5 h-5" />
                    )}
                  </Button>
                </div>
              </TabsContent>

              {/* ─── Email ─── */}
              <TabsContent value="email">
                <form onSubmit={submitEmail} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="pl-10"
                        autoComplete="username"
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="pl-10"
                        autoComplete="current-password"
                        required
                      />
                    </div>
                  </div>

                  <Button
                    type="submit"
                    className="w-full bg-primary hover:bg-primary/90 h-12 text-base"
                    disabled={emailLoading}
                  >
                    {emailLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Signing in…
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="w-4 h-4 mr-2" /> Sign In
                      </>
                    )}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <p className="text-center text-white/40 text-xs mt-6">
          MaxxCity Mall © {new Date().getFullYear()} — Adilabad, Telangana
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-maxx-green">
          <Loader2 className="w-8 h-8 animate-spin text-white" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
