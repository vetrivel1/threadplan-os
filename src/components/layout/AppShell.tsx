"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  LogOut,
  Settings,
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

  return (
    <div className="flex min-h-screen">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex flex-col border-r border-border bg-sidebar transition-[width] duration-300 ease-in-out",
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
          <Image
            src="/logo.png"
            alt="threadsPlan AI"
            width={40}
            height={40}
            loading="eager"
            className="h-10 w-10 shrink-0 rounded-xl"
          />
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">threadsPlan AI</p>
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
            <Image
              src="/planner-avatar.jpg"
              alt={organization.name}
              width={40}
              height={40}
              className="h-10 w-10 shrink-0 rounded-full object-cover ring-2 ring-border"
            />
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
            href="/engine"
            className={cn(
              "flex items-center rounded-lg transition-colors",
              pathname === "/engine"
                ? "bg-accent/15 text-accent-hover ring-1 ring-accent/25"
                : "text-muted hover:bg-surface-elevated hover:text-foreground",
              collapsed
                ? "h-10 w-10 justify-center"
                : "gap-3 px-3 py-2.5 text-sm"
            )}
            title="Planning rules — how the plan is decided"
          >
            <Settings className="h-4 w-4 shrink-0" />
            {!collapsed && "Planning Rules"}
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
        // min-w-0 lets this flex item shrink below its content width. Without it
        // a wide Gantt stretches main, the document scrolls sideways instead of
        // the timeline, and the sticky label column is dragged out of view.
        className="min-w-0 flex-1 transition-[margin] duration-300 ease-in-out"
        style={{ marginLeft: sidebarWidth }}
      >
        <PlanningFlow currentPath={pathname} />
        <div className="min-h-screen">{children}</div>
      </main>
    </div>
  );
}
