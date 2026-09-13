import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsUUID,
  Min,
  ValidateNested,
} from "class-validator";

export class IntegrationResourceSelectionDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  resourceId!: string;

  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;

  @ApiProperty({ enum: ["inbound", "outbound", "bidirectional"] })
  @IsIn(["inbound", "outbound", "bidirectional"])
  direction!: "inbound" | "outbound" | "bidirectional";
}

export class UpdateIntegrationResourcesDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiProperty({ type: [IntegrationResourceSelectionDto], maxItems: 250 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(250)
  @ArrayUnique((resource: IntegrationResourceSelectionDto) => resource.resourceId)
  @ValidateNested({ each: true })
  @Type(() => IntegrationResourceSelectionDto)
  resources!: IntegrationResourceSelectionDto[];
}
