"use client";

import { CalendarDays, CircleUserRound, GraduationCap, ShoppingBag, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Badge, Card } from "@/components/ui";
import type { AuthSessionResponse } from "@/lib/contracts";

export interface DashboardLink {
  label: string;
  description: string;
  href: string;
  icon: typeof Users;
  status: "available" | "coming-soon";
}

export const DASHBOARD_LINKS: DashboardLink[] = [
  {
    label: "Clients",
    description: "Manage client profiles and history.",
    href: "/clients",
    icon: Users,
    status: "available"
  },
  {
    label: "Appointments",
    description: "See and schedule upcoming visits.",
    href: "/appointments",
    icon: CalendarDays,
    status: "coming-soon"
  },
  {
    label: "Academy",
    description: "Browse the professional library.",
    href: "/academy",
    icon: GraduationCap,
    status: "coming-soon"
  },
  {
    label: "Marketplace",
    description: "Find recommended products and suppliers.",
    href: "/marketplace",
    icon: ShoppingBag,
    status: "coming-soon"
  },
  {
    label: "Account & Subscription",
    description: "View your plan and billing details.",
    href: "/account",
    icon: CircleUserRound,
    status: "available"
  }
];

export default function DashboardPage() {
  const [user, setUser] = useState<AuthSessionResponse["user"] | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadUser() {
      const response = await fetch("/api/v1/auth/me", { method: "GET" });
      if (!response.ok || cancelled) return;

      const payload = (await response.json()) as { authenticated: boolean; user: AuthSessionResponse["user"] };
      if (!cancelled && payload.authenticated) {
        setUser(payload.user);
      }
    }

    void loadUser();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div>
        {/* Mobile-polish follow-up: break-words on a single "Welcome back,
            <email>" line stopped the horizontal overflow, but broke the
            email itself mid-domain ("...@gmail.c" / "om") -- readable
            without overflowing, but not visually acceptable. Below sm:,
            the heading is a short static string and the email moves to
            its own line, truncated with an ellipsis (no mid-word/
            mid-domain breaks, and no way for it to force the viewport
            wider). Desktop keeps the original single-line presentation
            unchanged -- only the <sm: half of each pair is new. */}
        <h1 className="text-2xl font-semibold text-foreground">
          <span className="sm:hidden">Welcome back!</span>
          <span className="hidden sm:inline">{user ? `Welcome back, ${user.email}` : "Welcome back"}</span>
        </h1>
        {user ? <p className="mt-1 truncate text-sm text-muted sm:hidden">{user.email}</p> : null}
        <p className="mt-1 text-sm text-muted">
          AI Hair Architect is being rebuilt as a full product experience. Here is what is available today.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {DASHBOARD_LINKS.map((link) => (
          <Link key={link.href} href={link.href} className="block">
            <Card variant="interactive" className="flex h-full flex-col gap-3">
              <div className="flex items-center justify-between">
                <link.icon className="h-5 w-5 text-accent" aria-hidden="true" />
                {link.status === "coming-soon" ? <Badge variant="neutral">Coming soon</Badge> : null}
              </div>
              <div>
                <p className="font-medium text-foreground">{link.label}</p>
                <p className="mt-1 text-sm text-muted">{link.description}</p>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
