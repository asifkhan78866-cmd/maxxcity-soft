// ═══════════════════════════════════════
// Environment Validation
// ═══════════════════════════════════════
// Covers the misconfigurations that are silent and expensive: a placeholder
// left in place, the anon key pasted where the service-role key belongs, and
// a missing session secret in production.

import { describe, it, expect } from 'vitest';
import { serverEnvSchema, formatEnvIssues } from '@/lib/config/env-schema';
import { publicEnv, isSupabaseConfigured } from '@/lib/config/public-env';

const valid = {
  NODE_ENV: 'development',
  NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefghijklmnop.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.anon',
  SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.service',
  SESSION_SECRET: 'a'.repeat(48),
};

describe('a well-formed environment', () => {
  it('passes', () => {
    expect(serverEnvSchema.safeParse(valid).success).toBe(true);
  });

  it('tolerates every optional value being absent', () => {
    const result = serverEnvSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.GROQ_API_KEY).toBeUndefined();
      expect(result.data.BOOTSTRAP_TOKEN).toBeUndefined();
      expect(result.data.SUPABASE_DB_URL).toBeUndefined();
    }
  });
});

describe('required values', () => {
  it.each([
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ])('rejects a missing %s', (key) => {
    const env = { ...valid } as Record<string, string>;
    delete env[key];
    const result = serverEnvSchema.safeParse(env);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes(key))).toBe(true);
    }
  });

  it('rejects a project URL that is not a URL', () => {
    expect(
      serverEnvSchema.safeParse({ ...valid, NEXT_PUBLIC_SUPABASE_URL: 'abcdefg' }).success
    ).toBe(false);
  });
});

describe('placeholders are caught rather than passed through', () => {
  it.each([
    ['NEXT_PUBLIC_SUPABASE_URL', 'https://your-project-ref.supabase.co'],
    ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'your-supabase-publishable-or-anon-key'],
    ['SUPABASE_SERVICE_ROLE_KEY', 'your-server-only-service-role-or-secret-key'],
  ])('rejects the shipped placeholder for %s', (key, placeholder) => {
    const result = serverEnvSchema.safeParse({ ...valid, [key]: placeholder });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => /placeholder/i.test(i.message))).toBe(true);
    }
  });
});

describe('the dangerous misconfigurations', () => {
  it('rejects the anon key being reused as the service-role key', () => {
    // Both are `eyJ...` JWTs and look alike. Getting this wrong silently
    // downgrades every server query to anon permissions.
    const result = serverEnvSchema.safeParse({
      ...valid,
      SUPABASE_SERVICE_ROLE_KEY: valid.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => /same value as the anon key/i.test(i.message))).toBe(
        true
      );
    }
  });

  it('rejects a missing SESSION_SECRET in production', () => {
    const { SESSION_SECRET, ...withoutSecret } = valid;
    void SESSION_SECRET;
    const result = serverEnvSchema.safeParse({ ...withoutSecret, NODE_ENV: 'production' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => /SESSION_SECRET is required/i.test(i.message))).toBe(
        true
      );
    }
  });

  it('allows a missing SESSION_SECRET in development', () => {
    const { SESSION_SECRET, ...withoutSecret } = valid;
    void SESSION_SECRET;
    expect(serverEnvSchema.safeParse(withoutSecret).success).toBe(true);
  });

  it('rejects a session secret that is too short to be safe', () => {
    expect(serverEnvSchema.safeParse({ ...valid, SESSION_SECRET: 'short' }).success).toBe(false);
  });
});

describe('optional values, when present, must still be well-formed', () => {
  it('rejects a database URL that is not a postgres URI', () => {
    expect(
      serverEnvSchema.safeParse({ ...valid, SUPABASE_DB_URL: 'https://example.com' }).success
    ).toBe(false);
  });

  it('accepts both postgres:// and postgresql://', () => {
    for (const prefix of ['postgres://', 'postgresql://']) {
      expect(
        serverEnvSchema.safeParse({ ...valid, SUPABASE_DB_URL: `${prefix}u:p@h:5432/postgres` })
          .success
      ).toBe(true);
    }
  });

  it('rejects a bootstrap token short enough to guess', () => {
    expect(serverEnvSchema.safeParse({ ...valid, BOOTSTRAP_TOKEN: 'abc' }).success).toBe(false);
  });

  it('rejects a non-boolean ALLOW_SEED', () => {
    expect(serverEnvSchema.safeParse({ ...valid, ALLOW_SEED: 'yes' }).success).toBe(false);
    expect(serverEnvSchema.safeParse({ ...valid, ALLOW_SEED: 'true' }).success).toBe(true);
  });
});

describe('error reporting', () => {
  it('lists every problem at once, not just the first', () => {
    const result = serverEnvSchema.safeParse({ NODE_ENV: 'development' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const report = formatEnvIssues(result.error);
      expect(report).toContain('NEXT_PUBLIC_SUPABASE_URL');
      expect(report).toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY');
      expect(report).toContain('SUPABASE_SERVICE_ROLE_KEY');
      expect(report).toContain('docs/ENV_SETUP.md');
    }
  });
});

describe('the public env module carries nothing secret', () => {
  it('exposes only browser-safe keys', () => {
    // If a secret is ever added here it ships to every visitor, so the shape
    // is asserted explicitly rather than left to review.
    expect(Object.keys(publicEnv).sort()).toEqual([
      'emiBookingFee',
      'storeAddress',
      'storeCity',
      'storeGstin',
      'storeName',
      'storePhone',
      'storeUpiId',
      'supabaseAnonKey',
      'supabaseUrl',
      'terminalId',
    ]);
  });

  it('mentions no server-only variable name', () => {
    const serialised = JSON.stringify(publicEnv);
    for (const secret of ['SERVICE_ROLE', 'DB_URL', 'SESSION_SECRET', 'BOOTSTRAP']) {
      expect(serialised).not.toContain(secret);
    }
  });

  it('falls back to sensible store defaults', () => {
    expect(publicEnv.storeName).toBeTruthy();
    expect(publicEnv.emiBookingFee).toBeGreaterThan(0);
  });

  it('reports whether Supabase is configured', () => {
    expect(typeof isSupabaseConfigured()).toBe('boolean');
  });
});
