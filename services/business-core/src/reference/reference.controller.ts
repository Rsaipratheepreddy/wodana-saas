import { Controller, Get, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { DatabaseService } from "../database/database.service";
import { ListCurrenciesQueryDto } from "./dto/list-currencies-query.dto";
import { CurrencyResponseDto, PermissionResponseDto } from "./reference-response.dto";

@ApiTags("reference")
@ApiBearerAuth()
@Controller("reference")
export class ReferenceController {
  constructor(private readonly database: DatabaseService) {}

  @Get("currencies")
  @ApiOperation({ summary: "List globally supported ISO 4217 currencies" })
  @ApiOkResponse({ type: CurrencyResponseDto, isArray: true })
  listCurrencies(@Query() query: ListCurrenciesQueryDto) {
    const locale = Intl.getCanonicalLocales(query.locale)[0];
    const names = new Intl.DisplayNames([locale], { type: "currency" });

    return Intl.supportedValuesOf("currency").map((code) => ({
      code,
      name: names.of(code) ?? code,
      minorUnit: new Intl.NumberFormat(locale, {
        style: "currency",
        currency: code,
      }).resolvedOptions().maximumFractionDigits,
    }));
  }

  @Get("permissions")
  @ApiOperation({ summary: "List permissions available for custom roles" })
  @ApiOkResponse({ type: PermissionResponseDto, isArray: true })
  async listPermissions() {
    const result = await this.database.query<{ code: string; description: string }>(
      "SELECT code, description FROM permissions ORDER BY code",
    );
    return result.rows;
  }
}
