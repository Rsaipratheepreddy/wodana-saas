"use client";

import { useEffect } from "react";
import type { PreProjectCase } from "@/lib/pre-project/types";
import { usePreProject } from "./pre-project-context";

/** Names the open planning case in the top bar and the window title, whichever tab renders below it. */
export function CaseSelection({ record, search }: { record: PreProjectCase; search: string }) {
  const { setSelected } = usePreProject();
  useEffect(() => { setSelected({ record, search }); }, [record, search, setSelected]);
  return null;
}
