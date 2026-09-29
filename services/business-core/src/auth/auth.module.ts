import { Global, Module } from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { AuthGuard } from "./auth.guard";
import { IdentityService } from "./identity.service";
import { MeController } from "./me.controller";
import { AuthController } from "./auth.controller";
import { LocalAuthService } from "./local-auth.service";
import { SecurityController } from "./security.controller";
import { EmailModule } from "../email/email.module";
import { MfaService } from "./mfa.service";
import { PlatformAuthController } from "./platform-auth.controller";
import { PlatformAuthService } from "./platform-auth.service";
import { TenantWriteBlockGuard } from "./tenant-write-block.guard";
import { ViewAsController } from "./view-as/view-as.controller";
import { ViewAsGuard } from "./view-as/view-as.guard";
import { ViewAsInterceptor } from "./view-as/view-as.interceptor";
import { ViewAsService } from "./view-as/view-as.service";

@Global()
@Module({
  imports: [EmailModule],
  controllers: [AuthController, PlatformAuthController, MeController, SecurityController, ViewAsController],
  providers: [
    IdentityService,
    MfaService,
    LocalAuthService,
    PlatformAuthService,
    ViewAsService,
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    // Runs after sign-in is checked: a suspended organization reads and exports but does not change.
    {
      provide: APP_GUARD,
      useClass: TenantWriteBlockGuard,
    },
    // Then view as: a sign-in session viewing as someone reads as them and changes nothing.
    {
      provide: APP_GUARD,
      useClass: ViewAsGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ViewAsInterceptor,
    },
  ],
  exports: [IdentityService, LocalAuthService, PlatformAuthService, ViewAsService],
})
export class AuthModule {}
