import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCESS_COOKIE, REFRESH_COOKIE, TENANT_COOKIE, businessApiUrl } from "@/lib/auth/server";

export async function POST() {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get(REFRESH_COOKIE)?.value;
  if (refreshToken) {
    const upstream = await fetch(businessApiUrl("/auth/logout"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken }),
      cache: "no-store",
    }).catch(() => null);
    if (!upstream?.ok) return NextResponse.json({ message: "Unable to log out this device. Please try again." }, { status: 503 });
  }
  const response = NextResponse.json({ signedOut: true });
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE, TENANT_COOKIE]) {
    response.cookies.set(name, "", { expires: new Date(0), path: "/" });
  }
  return response;
}
