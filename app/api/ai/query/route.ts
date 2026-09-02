// ═══════════════════════════════════════
// AI Query (Groq — llama-3.3-70b)
// ═══════════════════════════════════════
// The previous version returned invented "demo" answers with fabricated
// revenue figures when no API key was present. That is removed: a store owner
// must never be shown made-up numbers that look like their own data. Without
// a key the route says the assistant is unavailable.

import { withPermission, ok, fail } from '@/lib/auth/guard';
import { parseOrThrow } from '@/lib/validation/schemas';
import { z } from 'zod';

const querySchema = z.object({
  question: z.string().trim().min(3, 'Ask a question').max(1000),
});

export const POST = withPermission(
  'ai.read',
  async (request) => {
    const body = parseOrThrow(querySchema, await request.json());

    if (!process.env.GROQ_API_KEY) {
      return fail(
        'The AI assistant is not configured. Add GROQ_API_KEY to the environment to enable it.',
        503,
        'AI_NOT_CONFIGURED'
      );
    }

    const { queryGroq, buildQueryContext, fetchSalesContext } = await import('@/lib/ai');

    const ctx = await fetchSalesContext();
    const result = await queryGroq(body.question, buildQueryContext(ctx));

    return ok({
      answer: result.answer,
      chart_type: result.chart_type,
      model: 'llama-3.3-70b-versatile',
      dataThrough: new Date().toISOString(),
    });
  },
  'ai/query'
);
