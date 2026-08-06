import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import {
  getSupabaseKey,
  getSupabaseUrl,
  hasSupabaseCredentials,
} from "./env";

export async function createSupabaseServerClient() {
  const url = getSupabaseUrl();
  const key = getSupabaseKey();

  if (!url || !key) return null;

  const cookieStore = await cookies();

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // setAll can fail in Server Components — safe to ignore
        }
      },
    },
  });
}

export function isSupabaseConfigured(): boolean {
  return hasSupabaseCredentials();
}
