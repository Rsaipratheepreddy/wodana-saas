import { ApiProperty } from "@nestjs/swagger";
import { IsInt, IsString, MaxLength, Min } from "class-validator";

export class RequestOperatorDomainDto {
  @ApiProperty({ example: "portal.example.com" })
  @IsString() @MaxLength(253)
  hostname!: string;
}

export class VersionedOperatorDomainDto {
  @ApiProperty({ minimum: 1 })
  @IsInt() @Min(1)
  expectedVersion!: number;
}
