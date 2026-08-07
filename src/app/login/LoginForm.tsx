"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import logoImage from "../../../public/logo.png";
import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { safeRedirectPath } from "@/lib/supabase/env";

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = safeRedirectPath(searchParams.get("redirect"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supabaseConfigured = isSupabaseConfigured();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      router.push(redirect);
      return;
    }

    try {
      if (mode === "signup") {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
        });
        if (signUpError) throw signUpError;
        setError("Check your email to confirm your account.");
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) throw signInError;
        document.cookie = "threadplan_demo=; path=/; max-age=0";
        router.push(redirect);
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  const handleDemoMode = () => {
    document.cookie = "threadplan_demo=1; path=/; max-age=86400";
    router.push(redirect);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Image
            src={logoImage}
            alt="threadsPlan"
            width={56}
            height={56}
            loading="eager"
            className="mx-auto mb-4 h-14 w-14 rounded-2xl"
          />
          <h1 className="text-2xl font-bold">
            threadsPlan
            <sup className="ml-0.5 text-xs font-semibold">™</sup>
          </h1>
          <p className="mt-1 text-sm text-muted">
            Adaptive apparel planning &amp; scheduling, powered by AI
          </p>
        </div>

        <div className="rounded-xl border border-border bg-surface p-6">
          {supabaseConfigured ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-xs text-muted">Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  placeholder="planner@aurora-textiles.com"
                />
              </div>
              <div>
                <label className="text-xs text-muted">Password</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  placeholder="••••••••"
                />
              </div>

              {error && <p className="text-sm text-warning">{error}</p>}

              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent py-2.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                {mode === "signin" ? "Sign In" : "Create Account"}
              </button>

              <button
                type="button"
                onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
                className="w-full text-center text-sm text-muted hover:text-foreground"
              >
                {mode === "signin"
                  ? "Need an account? Sign up"
                  : "Already have an account? Sign in"}
              </button>
            </form>
          ) : (
            <p className="text-center text-sm text-muted">
              Supabase is not configured. Continue in demo mode with in-memory data.
            </p>
          )}

          <div className="mt-4 border-t border-border pt-4">
            <button
              onClick={handleDemoMode}
              className="w-full rounded-lg border border-border py-2.5 text-sm font-medium hover:bg-surface-elevated"
            >
              Continue in Demo Mode
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
