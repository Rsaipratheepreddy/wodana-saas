import { Transform } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  MinLength,
  MaxLength,
  Min,
} from "class-validator";

export class UpdateTenantManagementDto {
  @IsInt()
  @Min(1)
  expectedWorkspaceVersion!: number;

  @IsInt()
  @Min(1)
  expectedSubscriptionVersion!: number;

  @IsOptional()
  @IsIn(["active", "suspended"])
  workspaceStatus?: "active" | "suspended";

  @IsOptional()
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsIn(["starter", "pro", "enterprise"])
  planCode?: "starter" | "pro" | "enterprise";

  @IsOptional()
  @IsIn(["trial", "active", "past_due", "cancelled"])
  subscriptionStatus?: "trial" | "active" | "past_due" | "cancelled";

  @IsOptional()
  @IsIn(["monthly", "yearly", "custom"])
  billingCycle?: "monthly" | "yearly" | "custom";

  @IsOptional()
  @TypeNumber()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  seatLimit?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  projectLimit?: number;

  @IsOptional()
  @IsISO8601({ strict: true })
  renewsAt?: string | null;

  @IsOptional()
  @Transform(({ value }) => value === null ? null : String(value).trim())
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

function TypeNumber() {
  return Transform(({ value }) => value === "" || value === null ? undefined : Number(value));
}
