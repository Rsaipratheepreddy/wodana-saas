import { Transform } from "class-transformer";
import {
  IsDateString,
  IsIn,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

export class PublishDefinitionBaselineDto {
  @IsUUID() requestId!: string;
  @Matches(/^[0-9a-f]{64}$/) sourceHash!: string;
  @Transform(trim) @IsString() @MaxLength(1000) message!: string;
}

export class RecordDefinitionDecisionDto {
  @IsUUID() requestId!: string;
  @IsIn(["confirmed", "changes_requested"])
  decision!: "confirmed" | "changes_requested";
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(240)
  decisionBy!: string;
  @IsIn(["meeting", "email", "phone", "whatsapp", "signed_document", "other"])
  channel!: "meeting" | "email" | "phone" | "whatsapp" | "signed_document" | "other";
  @Transform(trim) @IsString() @MaxLength(5000)
  note!: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(3000)
  evidence!: string;
  @IsDateString() decidedAt!: string;
}
