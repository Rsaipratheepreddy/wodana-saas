import { IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from "class-validator";
import { FLOW_TEMPLATE_KEYS } from "../flow-templates";
import { STARTER_FLOW_CODES } from "../starter-flows";

/** The definition is checked by the flow validator (strict), not by class-validator. */
export class ValidateFlowDto {
  @IsObject() definition!: Record<string, unknown>;
}

export class PublishFlowDto {
  /** The version the editor started from (0 when the flow has none). */
  @IsInt() @Min(0) @Max(1_000_000) expectedVersion!: number;
  @IsObject() definition!: Record<string, unknown>;
  /** A new name for the flow, published with the version. */
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
}

/** A new flow starts from a starter flow, a library template or a version of one of the workspace's flows (exactly one). */
export class CreateFlowDto {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsOptional() @IsIn(STARTER_FLOW_CODES) starter?: string;
  @IsOptional() @IsIn(FLOW_TEMPLATE_KEYS) templateKey?: string;
  @IsOptional() @IsUUID() sourceFlowId?: string;
  /** The version to copy (the latest when omitted); a version the flow does not have is refused. */
  @IsOptional() @IsInt() @Min(1) @Max(1_000_000) sourceVersion?: number;
}

export class AssignEnquiryTypeFlowDto {
  /** The enquiry type's version. */
  @IsInt() @Min(1) version!: number;
}
