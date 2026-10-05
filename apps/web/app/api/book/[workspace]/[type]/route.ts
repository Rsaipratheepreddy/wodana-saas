import { forwardPublic, SLUG } from "@/lib/booking/public-proxy.server";

/** Books a slot (the service re-checks it, and the same request twice books once). */
export async function POST(request: Request, { params }: { params: Promise<{ workspace: string; type: string }> }) {
  const { workspace, type } = await params;
  if (!SLUG.test(workspace) || !SLUG.test(type)) return Response.json({ message: "Not found" }, { status: 404 });
  return forwardPublic(request, `${workspace}/${type}`, { method: "POST", write: true });
}
