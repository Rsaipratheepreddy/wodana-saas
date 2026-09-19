import { Controller, Get, Header, Param, Query, Res } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { Response } from "express";
import { Public } from "../auth/public.decorator";
import { WorkspacesService } from "./workspaces.service";

@ApiExcludeController()
@Public()
@Controller("public/tenant-branding")
export class PublicBrandingController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get(":loginSlug/logo")
  @Header("Cross-Origin-Resource-Policy", "cross-origin")
  async logo(@Param("loginSlug") loginSlug: string, @Query("variant") variant: string | undefined, @Res() response: Response) {
    const logo = await this.workspaces.readPublicCompanyLogo(loginSlug, variant === "square" ? "square" : "display");
    response.set({
      "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
      "content-type": logo.contentType,
      etag: `\"${logo.etag}\"`,
    });
    response.send(logo.body);
  }
}
