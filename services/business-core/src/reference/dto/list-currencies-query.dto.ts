import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional } from "class-validator";
import { IsLocale } from "../../common/regional.validators";

export class ListCurrenciesQueryDto {
  @ApiPropertyOptional({ example: "en", default: "en" })
  @IsOptional()
  @IsLocale()
  locale: string = "en";
}
