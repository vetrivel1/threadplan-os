/**
 * Supabase credentials. Newer Supabase projects issue a "publishable key" while
 * older ones call the same value the "anon key" — accept either so a valid
 * .env does not silently fall through to demo mode.
 *
 * These must be read as full literal `process.env.X` expressions for Next.js to
 * inline them into the client bundle.
 */
export function getSupabaseUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_URL;
}

export function getSupabaseKey(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
}

export function hasSupabaseCredentials(): boolean {
  return Boolean(getSupabaseUrl() && getSupabaseKey());
}

/**
 * Restrict a post-login redirect to a same-origin absolute path so a crafted
 * `?next=//evil.com` cannot bounce the user off-site.
 */
export function safeRedirectPath(
  value: string | null | undefined,
  fallback = "/orders"
): string {
  if (!value) return fallback;
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback;
  return value;
}
