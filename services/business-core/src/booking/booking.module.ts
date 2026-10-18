import { Module } from "@nestjs/common";
import { CrmIntakeModule } from "../crm/intake/crm-intake.module";
import { EmailModule } from "../email/email.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { BookingController, PublicBookingController } from "./booking.controller";
import { BookingMailer } from "./booking-mailer";
import { BookingTypesService } from "./booking-types.service";
import { BookingsService } from "./bookings.service";

/** Booking pages (plan §6.5b): booking types in Sales settings, the public pages, and bookings on the calendar. */
@Module({
  imports: [WorkspacesModule, CrmIntakeModule, EmailModule],
  controllers: [BookingController, PublicBookingController],
  providers: [BookingTypesService, BookingsService, BookingMailer],
  exports: [BookingsService],
})
export class BookingModule {}
