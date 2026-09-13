import { Request } from "express";
import { RequestActor } from "./actor";

export interface AuthenticatedRequest extends Request {
  actor: RequestActor;
}

