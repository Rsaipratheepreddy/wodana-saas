import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { renderBrandedEmail } from "../email/branded-email";
import { TransactionalEmailService, type EmailDeliveryResult } from "../email/transactional-email.service";
import { bookingIcs, describeSlot } from "./booking.domain";

export type BookingMail = {
  workspaceId: string; bookingId: string; version: number; kind: "confirmed" | "requested" | "rescheduled" | "cancelled";
  to: string | null; visitorName: string; typeName: string; startsAt: Date | string; endsAt: Date | string;
  visitorTimeZone: string; firmTimeZone: string; locale: string; location: string | null; manageUrl: string | null; direction?: "ltr" | "rtl";
};

/**
 * The visitor's emails: confirmation (with the .ics invitation), request received, moved, cancelled. Each is
 * rendered through the one branded layout with the tenant's brand; Wodana appears only as "Powered by".
 */
@Injectable()
export class BookingMailer {
  private readonly logger = new Logger(BookingMailer.name);
  constructor(private readonly emails: TransactionalEmailService, private readonly config: ConfigService) {}

  origin() {
    return this.config.get<string>("WEB_ORIGIN", "http://localhost:3000").split(",")[0].trim();
  }

  async brandName(workspaceId: string) {
    return (await this.emails.brand({ workspaceId })).name;
  }

  async send(mail: BookingMail): Promise<EmailDeliveryResult | null> {
    if (!mail.to) return null;
    try {
      const brand = await this.emails.brand({ workspaceId: mail.workspaceId });
      const when = describeSlot(mail.startsAt, mail.endsAt, mail.visitorTimeZone, mail.locale);
      const firm = mail.firmTimeZone !== mail.visitorTimeZone ? describeSlot(mail.startsAt, mail.endsAt, mail.firmTimeZone, mail.locale) : null;
      const copy = {
        confirmed: { subject: `Booked: ${mail.typeName} with ${brand.name}`, heading: "Your booking is confirmed" },
        requested: { subject: `Request received: ${mail.typeName} with ${brand.name}`, heading: "We received your request" },
        rescheduled: { subject: `New time: ${mail.typeName} with ${brand.name}`, heading: "Your booking has a new time" },
        cancelled: { subject: `Cancelled: ${mail.typeName} with ${brand.name}`, heading: "Your booking is cancelled" },
      }[mail.kind];
      const paragraphs = [
        mail.visitorName.trim() ? `Hello ${mail.visitorName.trim()},` : "Hello,",
        `${mail.typeName}: ${when}`,
        ...(firm ? [`Our time: ${firm}`] : []),
        ...(mail.location && mail.kind !== "cancelled" ? [`Where: ${mail.location}`] : []),
        ...(mail.kind === "requested" ? ["We will confirm it shortly."] : []),
      ];
      const { html, text } = renderBrandedEmail({
        brand, preheader: copy.heading, heading: copy.heading, paragraphs, direction: mail.direction,
        ...(mail.manageUrl && mail.kind !== "cancelled" ? { action: { label: "Reschedule or cancel", url: mail.manageUrl } } : {}),
      });
      const attachments = mail.kind === "requested" ? [] : [{
        filename: "booking.ics", contentType: `text/calendar; charset=utf-8; method=${mail.kind === "cancelled" ? "CANCEL" : "REQUEST"}`,
        content: bookingIcs({ uid: `${mail.bookingId}@wodana`, sequence: mail.version, method: mail.kind === "cancelled" ? "CANCEL" : "REQUEST", start: mail.startsAt, end: mail.endsAt,
          summary: `${mail.typeName} · ${brand.name}`, location: mail.location, organizer: { name: brand.name }, attendee: { name: mail.visitorName, email: mail.to }, url: mail.manageUrl }),
      }];
      return await this.emails.send({ to: mail.to, subject: copy.subject, text, html, fromName: brand.name, attachments });
    } catch (error) {
      this.logger.error(`Booking email could not be sent (${error instanceof Error ? error.name : "UnknownError"})`);
      return { status: "failed", provider: null, messageId: null };
    }
  }
}
