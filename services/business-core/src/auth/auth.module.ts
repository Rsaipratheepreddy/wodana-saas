import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthGuard } from "./auth.guard";
import { IdentityService } from "./identity.service";
import { MeController } from "./me.controller";
import { AuthController } from "./auth.controller";
import { LocalAuthService } from "./local-auth.service";
import { SecurityController } from "./security.controller";
import { EmailModule } from "../email/email.module";

@Global()
@Module({
  imports: [EmailModule],
  controllers: [AuthController, MeController, SecurityController],
  providers: [
    IdentityService,
    LocalAuthService,
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
  ],
  exports: [IdentityService, LocalAuthService],
})
export class AuthModule {}
