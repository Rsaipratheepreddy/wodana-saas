import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min, ValidateIf } from "class-validator";
import { FURNITURE_PATHS, PAYMENT_PROOF_KINDS, type FurniturePath } from "../flow-gates";

export class UpdateOpportunityFlowDto {
  @IsInt() @Min(1) version!: number;
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsIn(FURNITURE_PATHS) furniturePath?: FurniturePath | null;
  @IsOptional() @IsBoolean() feasibilityConfirmed?: boolean;
  @IsOptional() @IsBoolean() materialsChange?: boolean;
  @IsOptional() @IsBoolean() clientApproved?: boolean;
}

/** Multipart fields arrive as text. */
export class AttachPaymentProofDto {
  @IsString() @Matches(/^[1-9]\d{0,9}$/) version!: string;
  @IsIn(PAYMENT_PROOF_KINDS) kind!: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  /** PLM-103: which proposal the proof pays (Proposal 1 design fee, Proposal 2 main); Proposal 2 can be a second Won. */
  @IsOptional() @IsIn(["design", "main"]) proposal?: string;
}
