import { hrmsProxy } from "@/lib/hrms/proxy";
async function handle(
  request: Request,
  { params }: { params: Promise<{ path?: string[] }> },
) {
  return hrmsProxy(request, (await params).path ?? [], "projects");
}
export { handle as GET, handle as POST, handle as PUT };
