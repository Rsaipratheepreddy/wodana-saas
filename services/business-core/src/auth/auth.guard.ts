import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import * as jwt from "jsonwebtoken";
import { JwtPayload } from "jsonwebtoken";
import jwksClient, { JwksClient } from "jwks-rsa";
import { DatabaseService } from "../database/database.service";
import { sessionDeviceLimit } from "./session-policy";
import { RequestActor } from "./actor";
import { AuthenticatedRequest } from "./authenticated-request";
import { IS_PUBLIC_KEY } from "./public.decorator";

interface WodanaJwtPayload extends JwtPayload {
  sid?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

export function hasVerifiedOidcIdentity(
  claims: WodanaJwtPayload,
): claims is WodanaJwtPayload & { sub: string; email: string; email_verified: true } {
  return Boolean(claims.sub && claims.email && claims.email_verified === true);
}

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly jwks?: JwksClient;

  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
    private readonly database: DatabaseService,
  ) {
    const jwksUri = this.config.get<string>("OIDC_JWKS_URI");
    if (jwksUri) {
      this.jwks = jwksClient({
        jwksUri,
        cache: true,
        cacheMaxEntries: 5,
        rateLimit: true,
        jwksRequestsPerMinute: 10,
      });
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authMode = this.config.get<string>("AUTH_MODE", "development");
    request.actor = authMode === "development"
      ? this.readDevelopmentActor(request)
      : authMode === "local" || authMode === "password"
        ? await this.verifyLocalActor(request)
        : await this.verifyOidcActor(request);
    return true;
  }

  private readDevelopmentActor(request: AuthenticatedRequest): RequestActor {
    if (this.config.get<string>("NODE_ENV", "development") === "production") {
      throw new UnauthorizedException("Development authentication is disabled in production");
    }

    const subject = this.header(request, "x-wodana-user-subject");
    const email = this.header(request, "x-wodana-user-email");
    if (!subject || !email) {
      throw new UnauthorizedException(
        "Local requests require x-wodana-user-subject and x-wodana-user-email headers",
      );
    }

    const displayName = this.header(request, "x-wodana-user-name") ?? email;
    return { subject, email: email.toLowerCase(), displayName, provider: "development" };
  }

  private async verifyOidcActor(request: AuthenticatedRequest): Promise<RequestActor> {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Bearer token is required");
    }

    const token = authorization.slice("Bearer ".length);
    const decoded = jwt.decode(token, { complete: true });
    const kid = decoded?.header.kid;
    if (!kid || !this.jwks) {
      throw new UnauthorizedException("OIDC signing configuration is incomplete");
    }

    try {
      const signingKey = await this.jwks.getSigningKey(kid);
      const claims = jwt.verify(token, signingKey.getPublicKey(), {
        algorithms: ["RS256"],
        audience: this.config.getOrThrow<string>("OIDC_AUDIENCE"),
        issuer: this.config.getOrThrow<string>("OIDC_ISSUER"),
      }) as WodanaJwtPayload;

      if (!hasVerifiedOidcIdentity(claims)) {
        throw new UnauthorizedException("A verified email claim is required");
      }

      return {
        subject: claims.sub,
        email: claims.email.toLowerCase(),
        displayName: claims.name ?? claims.email,
        provider: claims.iss ?? "oidc",
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException("Bearer token is invalid or expired");
    }
  }

  private async verifyLocalActor(request: AuthenticatedRequest): Promise<RequestActor> {
    if (this.config.get<string>("NODE_ENV", "development") === "production"
      && this.config.get<string>("AUTH_MODE") !== "password") {
      throw new UnauthorizedException("Local authentication is disabled in production");
    }
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Bearer token is required");
    }
    try {
      const claims = jwt.verify(
        authorization.slice("Bearer ".length),
        this.config.getOrThrow<string>("LOCAL_AUTH_JWT_SECRET"),
        {
          algorithms: ["HS256"],
          audience: this.config.get<string>("LOCAL_AUTH_AUDIENCE", "wodana-web"),
          issuer: this.config.get<string>("LOCAL_AUTH_ISSUER", "wodana-local"),
        },
      ) as WodanaJwtPayload;
      if (!hasVerifiedOidcIdentity(claims)) {
        throw new UnauthorizedException("A verified local identity is required");
      }
      if (!claims.sid || !/^[0-9a-f-]{36}$/i.test(claims.sid)) {
        throw new UnauthorizedException("Sign in again to secure this device.");
      }
      const active = await this.database.query(
        `SELECT 1 FROM auth_refresh_sessions session
         JOIN users app_user ON app_user.id = session.user_id AND app_user.status = 'active'
         WHERE session.family_id = $1 AND 'local:' || session.user_id::text = $2
           AND session.revoked_at IS NULL AND session.expires_at > now()
           AND ($3::integer IS NULL OR (SELECT count(DISTINCT family_id) FROM auth_refresh_sessions
                WHERE user_id = session.user_id AND revoked_at IS NULL AND expires_at > now()) <= $3)`,
        [claims.sid, claims.sub, sessionDeviceLimit(claims.sub.replace(/^local:/, ""), this.config.get<string>("AUTH_DEVICE_LIMIT_EXEMPT_USER_IDS", ""))],
      );
      if (!active.rowCount) throw new UnauthorizedException("This device was logged out or its session expired.");
      return {
        subject: claims.sub,
        email: claims.email.toLowerCase(),
        displayName: claims.name ?? claims.email,
        provider: "local",
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException("Bearer token is invalid or expired");
    }
  }

  private header(request: AuthenticatedRequest, name: string): string | undefined {
    const value = request.headers[name];
    return Array.isArray(value) ? value[0] : value;
  }
}
