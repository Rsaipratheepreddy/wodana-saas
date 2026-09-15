import { SetMetadata } from "@nestjs/common";

export const MFA_ACTION_KEY = "wodana:mfa-action";
export const MFA_ENROLLMENT_ALLOWED_KEY = "wodana:mfa-enrollment-allowed";

export const RequireRecentMfa = (action: string) => SetMetadata(MFA_ACTION_KEY, action);
export const AllowDuringMfaEnrollment = () => SetMetadata(MFA_ENROLLMENT_ALLOWED_KEY, true);
