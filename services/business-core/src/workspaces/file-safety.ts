import { BadRequestException } from "@nestjs/common";
import { createHash } from "node:crypto";

const EICAR_MARKER = "EICAR-STANDARD-ANTIVIRUS-TEST-FILE";

export type FileSafetyResult = {
  status: "baseline_clean" | "quarantined";
  scanner: "wodana_baseline";
  sha256: string;
  reason: string | null;
};

/**
 * Synchronous baseline applied before every object write. It blocks the standard
 * anti-malware test signature and executable headers. A configured external AV
 * remains a separate production capability and must never be implied by this result.
 */
export function inspectObject(body: Buffer): FileSafetyResult {
  const sha256 = createHash("sha256").update(body).digest("hex");
  const sample = body.subarray(0, Math.min(body.length, 1024 * 1024));
  if (sample.toString("latin1").includes(EICAR_MARKER)) {
    return { status: "quarantined", scanner: "wodana_baseline", sha256, reason: "known_test_signature" };
  }
  if (sample.length >= 2 && sample[0] === 0x4d && sample[1] === 0x5a) {
    return { status: "quarantined", scanner: "wodana_baseline", sha256, reason: "executable_content" };
  }
  return { status: "baseline_clean", scanner: "wodana_baseline", sha256, reason: null };
}

export function assertObjectSafe(body: Buffer) {
  const result = inspectObject(body);
  if (result.status === "quarantined") {
    throw new BadRequestException("This file was blocked by the safety scan.");
  }
  return result;
}

