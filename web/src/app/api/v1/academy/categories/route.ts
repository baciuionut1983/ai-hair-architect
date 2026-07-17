import { NextResponse } from "next/server";

import { getAcademyCategories } from "@/lib/milestone1-store";

export async function GET() {
  const categories = getAcademyCategories();
  return NextResponse.json({ categories }, { status: 200 });
}
