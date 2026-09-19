import { NextResponse } from "next/server";

// Workspace branding is set by Wodana during tenant provisioning. This public
// route deliberately refuses tenant-initiated changes; the internal portal will
// receive its own audited configuration flow.
export async function PUT() {
  return NextResponse.json(
    { message: "Workspace branding is managed by Wodana." },
    { status: 403, headers: { "cache-control": "no-store" } },
  );
}
