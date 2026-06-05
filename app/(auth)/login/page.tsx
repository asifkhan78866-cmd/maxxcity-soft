'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import {
  Store,
  KeyRound,
  Mail,
  Lock,
  ShieldCheck,
  Loader2,
  Delete,
} from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'pin' | 'email'>('pin');

  // PIN state
  const [pin, setPin] = useState('');
  const [pinLoading, setPinLoading] = useState(false);

  // Email state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);

  const pinInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (activeTab === 'pin') {
      pinInputRef.current?.focus();
    }
  }, [activeTab]);

  // PIN login handler
  const handlePinLogin = async () => {
    if (pin.length !== 4) {
      toast.error('Please enter a 4-digit PIN');
      return;
    }

    setPinLoading(true);
    try {
      const res = await fetch('/api/auth/pin-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        toast.success(`Welcome, ${data.user.name}!`);
        // Store session in cookie
        document.cookie = `maxxcity_pin_session=${JSON.stringify({
          id: data.user.id,
          name: data.user.name,
          role: data.user.role,
        })}; path=/; max-age=86400; SameSite=Lax`;

        router.push(data.user.role === 'ADMIN' ? '/admin/dashboard' : '/billing');
      } else {
        toast.error(data.error || 'Invalid PIN');
        setPin('');
      }
    } catch {
      toast.error('Login failed. Please try again.');
    } finally {
      setPinLoading(false);
    }
  };

  // Email login handler
  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error('Please fill in all fields');
      return;
    }

    setEmailLoading(true);
    try {
      const res = await fetch('/api/auth/email-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        toast.success(`Welcome back, ${data.user.name}!`);
        document.cookie = `maxxcity_pin_session=${JSON.stringify({
          id: data.user.id,
          name: data.user.name,
          role: data.user.role,
        })}; path=/; max-age=86400; SameSite=Lax`;

        router.push('/admin/dashboard');
      } else {
        toast.error(data.error || 'Invalid credentials');
      }
    } catch {
      toast.error('Login failed. Please try again.');
    } finally {
      setEmailLoading(false);
    }
  };

  // PIN pad click
  const handlePinDigit = (digit: string) => {
    if (pin.length < 4) {
      const newPin = pin + digit;
      setPin(newPin);
      if (newPin.length === 4) {
        // Auto-submit after a brief delay
        setTimeout(() => {
          setPinLoading(true);
          fetch('/api/auth/pin-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin: newPin }),
          })
            .then((r) => r.json())
            .then((data) => {
              if (data.success) {
                toast.success(`Welcome, ${data.user.name}!`);
                document.cookie = `maxxcity_pin_session=${JSON.stringify({
                  id: data.user.id,
                  name: data.user.name,
                  role: data.user.role,
                })}; path=/; max-age=86400; SameSite=Lax`;
                router.push(data.user.role === 'ADMIN' ? '/admin/dashboard' : '/billing');
              } else {
                toast.error(data.error || 'Invalid PIN');
                setPin('');
              }
            })
            .catch(() => {
              toast.error('Login failed');
              setPin('');
            })
            .finally(() => setPinLoading(false));
        }, 200);
      }
    }
  };

  const handlePinBackspace = () => {
    setPin((prev) => prev.slice(0, -1));
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-maxx-green-dark via-maxx-green to-maxx-green-light p-4">
      {/* Background decorative elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-maxx-gold/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-maxx-gold/10 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-white/5 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* Logo / Store Header */}
        <div className="text-center mb-8 fade-in">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-white/10 backdrop-blur-xl border border-white/20 mb-4 shadow-2xl">
            <Store className="w-10 h-10 text-maxx-gold" />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">
            MaxxCity Mall
          </h1>
          <p className="text-white/70 mt-1 text-sm">
            Billing & Management System
          </p>
        </div>

        {/* Login Card */}
        <Card className="glass-card border-white/20 shadow-2xl fade-in">
          <CardHeader className="pb-4">
            <CardTitle className="text-center text-lg">Sign In</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs
              value={activeTab}
              onValueChange={(v) => setActiveTab(v as 'pin' | 'email')}
            >
              <TabsList className="grid w-full grid-cols-2 mb-6">
                <TabsTrigger value="pin" className="gap-2">
                  <KeyRound className="w-4 h-4" />
                  PIN Login
                </TabsTrigger>
                <TabsTrigger value="email" className="gap-2">
                  <Mail className="w-4 h-4" />
                  Admin Login
                </TabsTrigger>
              </TabsList>

              {/* ─── PIN Login Tab ─── */}
              <TabsContent value="pin" className="space-y-6">
                <div className="text-center text-sm text-muted-foreground">
                  Enter your 4-digit cashier PIN
                </div>

                {/* PIN Display */}
                <div className="flex justify-center gap-3">
                  {[0, 1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className={`w-14 h-14 rounded-xl border-2 flex items-center justify-center text-2xl font-bold transition-all duration-200 ${
                        pin.length > i
                          ? 'border-primary bg-primary/10 text-primary scale-105'
                          : 'border-border bg-muted/50'
                      }`}
                    >
                      {pin.length > i ? '●' : ''}
                    </div>
                  ))}
                </div>

                {/* Hidden input for keyboard entry */}
                <input
                  ref={pinInputRef}
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  value={pin}
                  onChange={(e) => {
                    const value = e.target.value.replace(/\D/g, '');
                    setPin(value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && pin.length === 4) {
                      handlePinLogin();
                    }
                  }}
                  className="sr-only"
                  aria-label="PIN input"
                />

                {/* PIN Pad */}
                <div className="grid grid-cols-3 gap-2 max-w-[240px] mx-auto">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                    <Button
                      key={d}
                      variant="outline"
                      className="h-14 text-xl font-semibold hover:bg-primary hover:text-primary-foreground transition-colors"
                      onClick={() => handlePinDigit(d)}
                      disabled={pinLoading}
                    >
                      {d}
                    </Button>
                  ))}
                  <Button
                    variant="outline"
                    className="h-14"
                    onClick={handlePinBackspace}
                    disabled={pinLoading}
                  >
                    <Delete className="w-5 h-5" />
                  </Button>
                  <Button
                    variant="outline"
                    className="h-14 text-xl font-semibold hover:bg-primary hover:text-primary-foreground transition-colors"
                    onClick={() => handlePinDigit('0')}
                    disabled={pinLoading}
                  >
                    0
                  </Button>
                  <Button
                    className="h-14 bg-primary hover:bg-primary/90"
                    onClick={handlePinLogin}
                    disabled={pinLoading || pin.length !== 4}
                  >
                    {pinLoading ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <ShieldCheck className="w-5 h-5" />
                    )}
                  </Button>
                </div>
              </TabsContent>

              {/* ─── Email Login Tab ─── */}
              <TabsContent value="email">
                <form onSubmit={handleEmailLogin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="email"
                        type="email"
                        placeholder="admin@maxxcity.in"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="pl-10"
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
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="pl-10"
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
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Signing in...
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="w-4 h-4 mr-2" />
                        Sign In as Admin
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
