import { createBrowserClient } from "@supabase/ssr";
import {
  getSupabaseKey,
  getSupabaseUrl,
  hasSupabaseCredentials,
} from "./env";

export function createSupabaseBrowserClient() {
  const url = getSupabaseUrl();
  const key = getSupabaseKey();

  if (!url || !key) return null;

  return createBrowserClient(url, key);
}

export function isSupabaseConfigured(): boolean {
  return hasSupabaseCredentials();
}
