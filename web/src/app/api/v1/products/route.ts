import { NextResponse } from "next/server";

import { getProducts, sanitize } from "@/lib/milestone1-store";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const countryCode = sanitize(url.searchParams.get("countryCode")).toUpperCase();
  const city = sanitize(url.searchParams.get("city"));
  const goalRaw = sanitize(url.searchParams.get("goal"));
  const category = sanitize(url.searchParams.get("category"));

  const goal =
    goalRaw === "refresh" ||
    goalRaw === "cover" ||
    goalRaw === "lighten" ||
    goalRaw === "correct" ||
    goalRaw === "reshape" ||
    goalRaw === "treat"
      ? goalRaw
      : undefined;

  const products = getProducts({
    countryCode: countryCode || undefined,
    city: city || undefined,
    goal,
    category: category || undefined
  });

  return NextResponse.json({ products }, { status: 200 });
}
