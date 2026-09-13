import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Public } from "./auth/public.decorator";
import { ServiceDescriptionResponseDto } from "./common/system-response.dto";

@ApiTags("system")
@Controller()
@Public()
export class AppController {
  @Get()
  @ApiOperation({ summary: "Describe the Business Core service" })
  @ApiOkResponse({ type: ServiceDescriptionResponseDto })
  describeService() {
    return {
      service: "business-core",
      version: "0.1.0",
      responsibility: "authoritative business data and workflows",
    };
  }
}
