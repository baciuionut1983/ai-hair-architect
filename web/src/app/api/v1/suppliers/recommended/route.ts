import { NextResponse } from "next/server";

import { getRecommendedSuppliers, sanitize } from "@/lib/milestone1-store";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const countryCode = sanitize(url.searchParams.get("countryCode")).toUpperCase();
  const city = sanitize(url.searchParams.get("city"));
  const category = sanitize(url.searchParams.get("category"));
  const goalRaw = sanitize(url.searchParams.get("goal"));

  const goal =
    goalRaw === "refresh" ||
    goalRaw === "cover" ||
    goalRaw === "lighten" ||
    goalRaw === "correct" ||
    goalRaw === "reshape" ||
    goalRaw === "treat"
      ? goalRaw
      : undefined;

  const suppliers = getRecommendedSuppliers({
    countryCode: countryCode || undefined,
    city: city || undefined,
    category: category || undefined,
    goal
  });

  return NextResponse.json({ suppliers }, { status: 200 });
}
