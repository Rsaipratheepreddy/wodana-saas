import { IsInt, IsString, IsUUID, MaxLength, Min, MinLength } from "class-validator";

export class SetJobStageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  stage!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(500)
  reason!: string;

  @IsInt()
  @Min(0)
  expectedVersion!: number;

  @IsUUID()
  requestId!: string;
}
