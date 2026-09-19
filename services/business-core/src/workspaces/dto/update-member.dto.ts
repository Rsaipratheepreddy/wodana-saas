import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ArrayUnique, IsArray, IsIn, IsInt, IsOptional, IsString, Min } from "class-validator";

export class UpdateMemberDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional({ enum: ["active", "suspended"] })
  @IsOptional()
  @IsIn(["active", "suspended"])
  status?: "active" | "suspended";

  @ApiPropertyOptional({ type: [String], example: ["viewer"] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  roleCodes?: string[];
}
