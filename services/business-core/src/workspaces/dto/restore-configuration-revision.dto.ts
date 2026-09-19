import { ApiProperty } from "@nestjs/swagger";
import { IsInt, IsUUID, Min } from "class-validator";

export class RestoreConfigurationRevisionDto {
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  version!: number;

  @ApiProperty({ format: "uuid" })
  @IsUUID()
  revisionId!: string;
}
