import { Module } from "@nestjs/common";
import { TransactionalEmailService } from "./transactional-email.service";

@Module({
  providers: [TransactionalEmailService],
  exports: [TransactionalEmailService],
})
export class EmailModule {}
