import { ApiProperty } from "@nestjs/swagger";

export class CurrencyResponseDto {
  @ApiProperty({ example: "AED" }) code!: string;
  @ApiProperty({ example: "UAE Dirham" }) name!: string;
  @ApiProperty({ example: 2 }) minorUnit!: number;
}

export class PermissionResponseDto {
  @ApiProperty() code!: string;
  @ApiProperty() description!: string;
}
