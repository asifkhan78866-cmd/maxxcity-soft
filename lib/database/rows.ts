// ═══════════════════════════════════════
// Query Result Helpers
// ═══════════════════════════════════════
// The project has no generated Supabase database types, so postgrest-js tries
// to infer row shapes by parsing the select string. For long or concatenated
// column lists that inference fails and produces a `ParserError`, which then
// masks real type errors downstream.
//
// These helpers make the shape explicit at the call site instead: the caller
// states what it expects, and the compiler checks the code that USES the row
// rather than the string that selected it.
//
// Regenerating real types (`supabase gen types typescript`) would be better
// still — see README, "Remaining configuration".

export function rows<T>(data: unknown): T[] {
  return (data ?? []) as T[];
}

export function row<T>(data: unknown): T | null {
  return (data ?? null) as T | null;
}
