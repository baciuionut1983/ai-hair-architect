"use client";

import { CalendarDays, CircleUserRound, GraduationCap, LayoutDashboard, ShoppingBag, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import type { AuthSessionResponse } from "@/lib/contracts";
import { ErrorState, LoadingState, Sidebar, Topbar } from "@/components/ui";
import type { SidebarNavItem } from "@/components/ui";

const NAV_ITEMS: SidebarNavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, status: "available" },
  { label: "Clients", href: "/clients", icon: Users, status: "available" },
  { label: "Appointments", href: "/appointments", icon: CalendarDays, status: "coming-soon" },
  { label: "Academy", href: "/academy", icon: GraduationCap, status: "coming-soon" },
  { label: "Marketplace", href: "/marketplace", icon: ShoppingBag, status: "coming-soon" },
  { label: "Account & Subscription", href: "/account", icon: CircleUserRound, status: "available" }
];

type AuthState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "authenticated"; user: AuthSessionResponse["user"] };

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      try {
        const response = await fetch("/api/v1/auth/me", { method: "GET" });
        if (cancelled) return;

        if (response.status === 401) {
          router.replace("/login");
          return;
        }

        if (!response.ok) {
          setAuth({ status: "error" });
          return;
        }

        const payload = (await response.json()) as { authenticated: boolean; user: AuthSessionResponse["user"] };
        if (!payload.authenticated) {
          router.replace("/login");
          return;
        }

        setAuth({ status: "authenticated", user: payload.user });
      } catch {
        if (!cancelled) {
          setAuth({ status: "error" });
        }
      }
    }

    void loadSession();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleLogout() {
    try {
      await fetch("/api/v1/auth/logout", { method: "POST" });
    } finally {
      router.replace("/login");
    }
  }

  if (auth.status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <LoadingState label="Loading your account..." />
      </div>
    );
  }

  if (auth.status === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <ErrorState
          title="We couldn't load your account"
          description="Please refresh the page. If this keeps happening, sign in again."
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <Sidebar items={NAV_ITEMS} mobileOpen={mobileNavOpen} onMobileClose={() => setMobileNavOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar userEmail={auth.user.email} onLogout={handleLogout} onMenuToggle={() => setMobileNavOpen(true)} />
        <main className="flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
