import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../../workspaces/workspaces.module";
import { BooksPostingController } from "./posting.controller";
import { BooksPostingService } from "./posting.service";

/** Posting rules P1 to P15: one adapter per source, the sweep and the posting issues (slice B). */
@Module({ imports: [WorkspacesModule], controllers: [BooksPostingController], providers: [BooksPostingService], exports: [BooksPostingService] })
export class BooksPostingModule {}
