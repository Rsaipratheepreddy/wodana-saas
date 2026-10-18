import { BadRequestException, Body, Controller, Get, Injectable, Param, ParseUUIDPipe, PipeTransform, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ArrayMaxSize, IsArray, IsInt, IsString, IsUUID, Max, MaxLength, Min } from "class-validator";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { isGridKey, MAX_HIDDEN_COLUMNS } from "./grid-settings.domain";
import { GridSettingsService } from "./grid-settings.service";

class SaveGridDefaultDto {
  @IsArray() @ArrayMaxSize(MAX_HIDDEN_COLUMNS) @IsString({ each: true }) @MaxLength(80, { each: true }) hiddenColumns!: string[];
  @IsInt() @Min(0) @Max(1_000_000) version!: number;
  @IsUUID() requestId!: string;
}

/** A list key such as "crm.enquiries": lower-case words joined by dots. */
@Injectable()
class GridKeyPipe implements PipeTransform<string, string> {
  transform(value: string) {
    if (!isGridKey(value)) throw new BadRequestException("Choose a valid list");
    return value;
  }
}

/** A list's workspace default (plan §0.7 R14): the columns that start hidden for everyone. */
@ApiTags("workspaces")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/grid-settings")
export class GridSettingsController {
  constructor(private readonly settings: GridSettingsService) {}

  @Get(":gridKey") get(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("gridKey", GridKeyPipe) gridKey: string) {
    return this.settings.get(actor, workspaceId, gridKey);
  }

  @Put(":gridKey") save(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("gridKey", GridKeyPipe) gridKey: string, @Body() input: SaveGridDefaultDto) {
    return this.settings.save(actor, workspaceId, gridKey, input);
  }
}
