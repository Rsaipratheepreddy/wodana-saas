import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { ApiProperty, ApiTags } from "@nestjs/swagger";
import { IsOptional, IsUUID } from "class-validator";
import { InternalServiceGuard } from "../../auth/internal-service.guard";
import { Public } from "../../auth/public.decorator";
import { RemindersEngineService } from "./reminders-engine.service";

export class ReminderSweepDto {
  @ApiProperty({ format: "uuid", required: false }) @IsOptional() @IsUUID() workspaceId?: string;
}

/** POST /internal/reminders/sweep: one workspace now (with a workspace id), else a timed pass over all of them. */
@ApiTags("reminders")
@Public()
@UseGuards(InternalServiceGuard)
@Controller("internal/reminders/sweep")
export class InternalRemindersController {
  constructor(private readonly engine: RemindersEngineService) {}

  @Post() sweep(@Body() body: ReminderSweepDto) {
    return body?.workspaceId ? this.engine.runNow(body.workspaceId) : this.engine.sweepAll();
  }
}
