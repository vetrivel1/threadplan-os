"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  LogOut,
  Settings,
  Sparkles,
  Radio,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useScheduleStore } from "@/lib/store/schedule-store";
import { useHydrated } from "@/lib/hooks/use-hydrated";
import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { PlanningFlow } from "@/components/dashboard/PlanningFlow";

const SIDEBAR_EXPANDED = 240;
const SIDEBAR_COLLAPSED = 72;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const organization = useScheduleStore((s) => s.organization);
  const source = useScheduleStore((s) => s.source);
  const isLoading = useScheduleStore((s) => s.isLoading);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [collapsedOverride, setCollapsedOverride] = useState<boolean | null>(
    null
  );
  const hydrated = useHydrated();

  // Server and first client render use the default; the stored preference is
  // applied once hydrated so the two renders always match.
  const storedCollapsed =
    hydrated && collapsedOverride === null
      ? localStorage.getItem("threadplan-sidebar-collapsed") === "true"
      : null;
  const collapsed = collapsedOverride ?? storedCollapsed ?? true;

  const isLoginPage = pathname === "/login";

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data.user?.email ?? null);
    });
  }, []);

  const toggleSidebar = () => {
    const next = !collapsed;
    localStorage.setItem("threadplan-sidebar-collapsed", String(next));
    setCollapsedOverride(next);
  };

  const handleSignOut = async () => {
    const supabase = createSupabaseBrowserClient();
    if (supabase) await supabase.auth.signOut();
    document.cookie = "threadplan_demo=; path=/; max-age=0";
    router.push("/login");
  };

  if (isLoginPage) {
    return <>{children}</>;
  }

  const sidebarWidth = collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED;
  const orgInitials = organization.name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="flex min-h-screen">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex flex-col border-r border-border bg-surface transition-[width] duration-300 ease-in-out",
          collapsed ? "w-[72px]" : "w-60"
        )}
      >
        {/* Brand */}
        <div
          className={cn(
            "flex h-16 items-center border-b border-border",
            collapsed ? "justify-center px-2" : "gap-3 px-4"
          )}
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/20 ring-1 ring-accent/30">
            <Sparkles className="h-5 w-5 text-accent" />
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">ThreadPlan OS</p>
              <p className="truncate text-[10px] text-muted">v0.1.0</p>
            </div>
          )}
        </div>

        {/* Org profile */}
        <div
          className={cn(
            "border-b border-border py-4",
            collapsed ? "flex justify-center px-2" : "px-4"
          )}
        >
          <div
            className={cn(
              "flex items-center",
              collapsed ? "justify-center" : "gap-3"
            )}
            title={organization.name}
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent/40 to-cutting/40 text-xs font-bold text-foreground ring-2 ring-border">
              {orgInitials}
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{organization.name}</p>
                <p className="truncate text-[10px] text-muted">
                  {userEmail ?? "Production Planner"}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Spacer — nav lives in workflow bar */}
        <div className="flex-1" />

        {/* Footer actions */}
        <div className={cn("space-y-1 p-3", collapsed && "flex flex-col items-center")}>
          <div
            className={cn(
              "flex items-center rounded-lg bg-surface-elevated text-muted",
              collapsed ? "h-10 w-10 justify-center" : "gap-2 px-3 py-2"
            )}
            title={
              isLoading
                ? "Syncing"
                : source === "supabase"
                  ? "Live · Supabase"
                  : "Demo mode"
            }
          >
            <Radio
              className={cn(
                "h-3.5 w-3.5 shrink-0",
                source === "supabase" ? "text-success" : "text-muted"
              )}
            />
            {!collapsed && (
              <span className="text-xs">
                {isLoading
                  ? "Syncing…"
                  : source === "supabase"
                    ? "Live"
                    : "Demo"}
              </span>
            )}
          </div>

          <Link
            href="#"
            className={cn(
              "flex items-center rounded-lg text-muted transition-colors hover:bg-surface-elevated hover:text-foreground",
              collapsed
                ? "h-10 w-10 justify-center"
                : "gap-3 px-3 py-2.5 text-sm"
            )}
            title="Settings"
          >
            <Settings className="h-4 w-4 shrink-0" />
            {!collapsed && "Settings"}
          </Link>

          <button
            onClick={handleSignOut}
            className={cn(
              "flex items-center rounded-lg text-muted transition-colors hover:bg-surface-elevated hover:text-foreground",
              collapsed
                ? "h-10 w-10 justify-center"
                : "w-full gap-3 px-3 py-2.5 text-sm"
            )}
            title="Sign Out"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {!collapsed && "Logout"}
          </button>

          <button
            onClick={toggleSidebar}
            className={cn(
              "flex items-center rounded-lg text-muted transition-colors hover:bg-surface-elevated hover:text-foreground",
              collapsed
                ? "h-10 w-10 justify-center"
                : "w-full gap-3 px-3 py-2.5 text-sm"
            )}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <>
                <ChevronLeft className="h-4 w-4 shrink-0" />
                Collapse
              </>
            )}
          </button>
        </div>
      </aside>

      <main
        className="flex-1 transition-[margin] duration-300 ease-in-out"
        style={{ marginLeft: sidebarWidth }}
      >
        <PlanningFlow currentPath={pathname} />
        <div className="min-h-screen">{children}</div>
      </main>
    </div>
  );
}
