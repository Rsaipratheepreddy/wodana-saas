import { IsInt, IsObject, Max, Min } from "class-validator";

/** The definition is checked by the flow validator (strict), not by class-validator. */
export class ValidateFlowDto {
  @IsObject() definition!: Record<string, unknown>;
}

export class PublishFlowDto {
  /** The version the editor started from (0 when the flow has none). */
  @IsInt() @Min(0) @Max(1_000_000) expectedVersion!: number;
  @IsObject() definition!: Record<string, unknown>;
}

export class AssignEnquiryTypeFlowDto {
  /** The enquiry type's version. */
  @IsInt() @Min(1) version!: number;
}
