import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
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

@Global()
@Module({
  imports: [EmailModule],
  controllers: [AuthController, PlatformAuthController, MeController, SecurityController],
  providers: [
    IdentityService,
    MfaService,
    LocalAuthService,
    PlatformAuthService,
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    // Runs after sign-in is checked: a suspended organization reads and exports but does not change.
    {
      provide: APP_GUARD,
      useClass: TenantWriteBlockGuard,
    },
  ],
  exports: [IdentityService, LocalAuthService, PlatformAuthService],
})
export class AuthModule {}
