import { NextResponse } from "next/server";

import { getAcademyLessons, sanitize } from "@/lib/milestone1-store";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const categoryId = sanitize(url.searchParams.get("categoryId"));

  const lessons = getAcademyLessons(categoryId || undefined);
  return NextResponse.json({ lessons }, { status: 200 });
}
