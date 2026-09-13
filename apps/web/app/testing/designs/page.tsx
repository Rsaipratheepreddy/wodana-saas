import { notFound } from "next/navigation";
import { DesignWorkspaceFixture } from "../../../e2e/fixtures/design-workspace";
export default function Page() {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.E2E_AUTH_BYPASS !== "true"
  )
    notFound();
  return <DesignWorkspaceFixture />;
}
