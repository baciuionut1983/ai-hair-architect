"use client";

import { CalendarDays, CircleUserRound, GraduationCap, LayoutDashboard, ShoppingBag, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import type { AuthSessionResponse } from "@/lib/contracts";
import { getLanguageDefinition, parseLanguageCode, type LanguageCode } from "@/lib/language-registry";
import { UiLanguageProvider, useUiLanguage } from "@/lib/ui-language-context";
import { ConciergeWorkflowMemoryProvider } from "@/components/concierge-workflow-memory-context";
import { ErrorState, LanguageSelector, LoadingState, Sidebar, Topbar } from "@/components/ui";
import type { SidebarNavItem } from "@/components/ui";

import { getMainContentClasses } from "./main-content-classes";

type AuthState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "authenticated"; user: AuthSessionResponse["user"] };

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // The account's own persisted language (see language-registry.ts) is the
  // real source of truth -- this override exists ONLY so picking a new
  // language in the selector updates the UI instantly, without waiting on
  // the POST /api/v1/account/locale round-trip or a page reload. Never a
  // second persisted copy: nothing here is read back from anywhere but
  // auth.user.locale once it arrives.
  const [languageOverride, setLanguageOverride] = useState<LanguageCode | null>(null);

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

  const uiLanguage: LanguageCode = languageOverride ?? parseLanguageCode(auth.status === "authenticated" ? auth.user.locale : undefined);

  // The root layout's <html> (app/layout.tsx) is deliberately static --
  // reading the session there to set lang/dir would force EVERY page
  // (including public, unauthenticated ones) out of static generation.
  // This effect is the real place lang/dir get set, covering both the
  // initial resolved language and every later selector change uniformly.
  // Trade-off, accepted deliberately: a brief flash of the LTR/English
  // default on first paint for an RTL account, rather than that app-wide
  // regression -- the loading spinner shown above has no directional
  // content of its own, so the flash is invisible in practice.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const definition = getLanguageDefinition(uiLanguage);
    document.documentElement.lang = definition?.locale ?? "en-US";
    document.documentElement.dir = definition?.direction ?? "ltr";
  }, [uiLanguage]);

  function handleUiLanguageChange(next: LanguageCode) {
    setLanguageOverride(next);
    // Best-effort persistence -- never blocks or fails the UI if it
    // doesn't succeed; User.locale (see language-registry.ts) is the one
    // real source of truth, this is simply the one write path to it.
    void fetch("/api/v1/account/locale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: next }),
    }).catch(() => {});
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
    <UiLanguageProvider language={uiLanguage}>
      {/* Production Fix #2 (cross-navigation conversational continuity):
          mounted here, at the SAME persistent level as UiLanguageProvider
          above -- this tree does not unmount for ordinary internal
          navigation between (app) routes (only {children} below does), so
          a client the Concierge already resolved on the Dashboard survives
          a trip to that client's own page and back. A hard refresh, a new
          tab, or leaving this layout entirely (e.g. logout, which
          navigates to /login -- outside the (app) route group) all
          naturally start a fresh provider instance instead. See
          concierge-workflow-memory-context.tsx's own header comment for
          the full root-cause/architecture writeup. */}
      <ConciergeWorkflowMemoryProvider>
        <AuthenticatedShell
          userEmail={auth.user.email}
          mobileNavOpen={mobileNavOpen}
          onMobileNavClose={() => setMobileNavOpen(false)}
          onMobileNavOpen={() => setMobileNavOpen(true)}
          onLogout={handleLogout}
          uiLanguage={uiLanguage}
          onUiLanguageChange={handleUiLanguageChange}
        >
          {children}
        </AuthenticatedShell>
      </ConciergeWorkflowMemoryProvider>
    </UiLanguageProvider>
  );
}

// Split out from AppLayout so it can call useUiLanguage() -- the provider
// above it must already be mounted for that hook to read the real value
// rather than its English-only fallback.
function AuthenticatedShell({
  userEmail,
  mobileNavOpen,
  onMobileNavClose,
  onMobileNavOpen,
  onLogout,
  uiLanguage,
  onUiLanguageChange,
  children,
}: {
  userEmail: string;
  mobileNavOpen: boolean;
  onMobileNavClose: () => void;
  onMobileNavOpen: () => void;
  onLogout: () => void;
  uiLanguage: LanguageCode;
  onUiLanguageChange: (next: LanguageCode) => void;
  children: ReactNode;
}) {
  const { t } = useUiLanguage();

  const navItems: SidebarNavItem[] = [
    { label: t("nav.dashboard"), href: "/dashboard", icon: LayoutDashboard, status: "available" },
    { label: t("nav.clients"), href: "/clients", icon: Users, status: "available" },
    { label: t("nav.appointments"), href: "/appointments", icon: CalendarDays, status: "coming-soon" },
    { label: t("nav.academy"), href: "/academy", icon: GraduationCap, status: "coming-soon" },
    { label: t("nav.marketplace"), href: "/marketplace", icon: ShoppingBag, status: "coming-soon" },
    { label: t("nav.account"), href: "/account", icon: CircleUserRound, status: "available" }
  ];

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <Sidebar items={navItems} mobileOpen={mobileNavOpen} onMobileClose={onMobileNavClose} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          userEmail={userEmail}
          onLogout={onLogout}
          onMenuToggle={onMobileNavOpen}
          logoutLabel={t("topbar.logout")}
          rightSlot={
            <LanguageSelector
              value={uiLanguage}
              onChange={onUiLanguageChange}
              label={t("language.label")}
              // Narrower floor on small phones (a fixed w-40/160px left no
              // room to shrink, contributing to Topbar-row horizontal
              // overflow) -- the trigger's own truncate handles a long
              // native-name label gracefully at either size.
              className="w-28 sm:w-40"
              searchPlaceholder={t("language.search")}
              noMatchesLabel={t("language.noMatches")}
            />
          }
        />
        <main className={getMainContentClasses()}>{children}</main>
      </div>
    </div>
  );
}
