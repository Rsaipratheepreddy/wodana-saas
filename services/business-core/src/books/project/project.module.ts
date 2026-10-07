import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../../workspaces/workspaces.module";
import { ProjectProfitController } from "./project-profit.controller";
import { ProjectProfitService } from "./project-profit.service";

/** Project profit from the Ledger and the Woddy tools that read it (slice E). */
@Module({ imports: [WorkspacesModule], controllers: [ProjectProfitController], providers: [ProjectProfitService], exports: [ProjectProfitService] })
export class BooksProjectModule {}
