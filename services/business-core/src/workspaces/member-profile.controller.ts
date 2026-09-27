import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Req, Res } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min, ValidateIf } from "class-validator";
import type { Request, Response } from "express";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { LANGUAGE_LOCALE_PATTERN, MemberProfileService, PROFILE_PHOTO_MAX_BYTES } from "./member-profile.service";

const PRESETS = [..."ab"].flatMap((set) => Array.from({ length: 10 }, (_, index) => `${set}${String(index + 1).padStart(2, "0")}`));

export class SetAvatarDto {
  @ValidateIf((_, value) => value !== null)
  @IsIn(PRESETS)
  avatarPreset!: string | null;

  @IsOptional() @IsInt() @Min(0)
  version?: number;
}

export class SetLanguageDto {
  @IsString() @MaxLength(35) @Matches(LANGUAGE_LOCALE_PATTERN)
  preferredLocale!: string;
}

@ApiTags("workspace members")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId")
export class MemberProfileController {
  constructor(private readonly profiles: MemberProfileService) {}

  @Get("me/profile")
  @ApiOperation({ summary: "My photo and avatar in this workspace" })
  @ApiOkResponse()
  mine(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) {
    return this.profiles.getMine(actor, workspaceId);
  }

  @Put("me/avatar")
  @ApiOperation({ summary: "Choose a default avatar (null clears the choice)" })
  setAvatar(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: SetAvatarDto) {
    return this.profiles.setAvatar(actor, workspaceId, input);
  }

  @Put("me/language")
  @ApiOperation({ summary: "Save my interface language (it follows me to every device)" })
  setLanguage(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: SetLanguageDto) {
    return this.profiles.setLanguage(actor, workspaceId, input.preferredLocale);
  }

  @Post("me/photo")
  @ApiOperation({ summary: "Upload a profile photo (raw PNG, JPG or WebP body)" })
  async uploadPhoto(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Req() request: Request) {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.byteLength;
      if (size > PROFILE_PHOTO_MAX_BYTES) throw new BadRequestException("Photo must be 5 MB or smaller");
      chunks.push(buffer);
    }
    return this.profiles.uploadPhoto(actor, workspaceId, String(request.headers["content-type"] ?? "").split(";")[0], Buffer.concat(chunks));
  }

  @Delete("me/photo")
  @ApiOperation({ summary: "Remove my profile photo" })
  removePhoto(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) {
    return this.profiles.removePhoto(actor, workspaceId);
  }

  @Get("members/:userId/photo")
  @ApiOperation({ summary: "A colleague's profile photo" })
  async photo(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("userId", ParseUUIDPipe) userId: string, @Res() response: Response) {
    const photo = await this.profiles.readPhoto(actor, workspaceId, userId);
    response.set({ "cache-control": "private, max-age=86400", "content-type": photo.contentType, etag: `"${photo.etag}"` });
    response.send(photo.body);
  }
}
