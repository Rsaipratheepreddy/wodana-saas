"use client";

import Image from "next/image";
import { useEffect, useState, type FormEvent } from "react";
import { CalendarPlus, CircleCheck, Clock, Globe, MapPin, Phone, Video } from "lucide-react";
import { Button, Callout, Checkbox, Form, PhoneField, SelectField, TextAreaField, TextInput, useDesignSystem } from "@/design-system";
import {
  browserZone, dateIn, formatDay, formatTime, sameZone, zoneCity,
  type BookingLink, type BookingResult, type LocationKind, type PublicBookingType, type PublicSlot,
} from "@/lib/booking/booking";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey, translateKnown, type MessageKey } from "@/lib/i18n/keys";
import { SlotPicker } from "./slot-picker";
import styles from "./booking.module.css";

const QUESTION_LABELS: Record<string, MessageKey> = {
  emirate: tKey("Location"), area: tKey("Area"), serviceType: tKey("What is the meeting about?"), budgetRange: tKey("Estimated budget"), summary: tKey("Anything we should know?"),
};

/** The facts under the title: how long, where, and the clock the times are shown on. */
export function BookingFacts({ durationMinutes, locationKind, locationDetail, visitorZone, firmTimeZone }: {
  durationMinutes: number; locationKind: LocationKind; locationDetail: string | null; visitorZone: string; firmTimeZone: string;
}) {
  const t = useT();
  const where = locationKind === "video" ? t("Video call") : locationKind === "phone" ? t("Phone call") : locationKind === "client_address" ? t("At your address") : locationDetail || t("At our studio");
  const Icon = locationKind === "video" ? Video : locationKind === "phone" ? Phone : MapPin;
  return <ul className={styles.facts}>
    <li><Clock size={15} aria-hidden="true" /><bdi>{t("{minutes} min", { minutes: durationMinutes })}</bdi></li>
    <li><Icon size={15} aria-hidden="true" />{where}</li>
    <li><Globe size={15} aria-hidden="true" />{sameZone(visitorZone, firmTimeZone)
      ? t("Times in {city} time", { city: zoneCity(visitorZone) })
      : t("Times in your time ({city}); we are on {firm} time", { city: zoneCity(visitorZone), firm: zoneCity(firmTimeZone) })}</li>
  </ul>;
}

/** The chosen time on the visitor's clock, with the firm's clock when it differs. */
export function ChosenTime({ slot, visitorZone, firmTimeZone, action }: { slot: PublicSlot; visitorZone: string; firmTimeZone: string; action?: React.ReactNode }) {
  const t = useT();
  const { locale } = useDesignSystem();
  const date = formatDay(dateIn(slot.start, visitorZone), locale, "long");
  return <div className={styles.chosen}>
    <p><strong>{date}</strong><span><bdi>{formatTime(slot.start, visitorZone, locale)} – {formatTime(slot.end, visitorZone, locale)}</bdi></span>
      {sameZone(visitorZone, firmTimeZone) ? null : <small><bdi>{t("{time} {city} time", { time: formatTime(slot.start, firmTimeZone, locale), city: zoneCity(firmTimeZone) })}</bdi></small>}</p>
    {action}
  </div>;
}

/**
 * The public booking page: pick a day, then a time, then a short form; done shows "Add to calendar" and the
 * manage link. Each booking is also an enquiry (the service runs it through the same intake as every form).
 */
export function PublicBooking({ data, workspace, link, embedded = false, slots, initial }: {
  data: PublicBookingType; workspace: string; link?: BookingLink; embedded?: boolean; slots?: PublicSlot[];
  /** A preview opened at a given step (Sales settings, screenshots); people always start at "pick". */
  initial?: { step: "pick" | "form" | "done"; slot?: PublicSlot; result?: BookingResult };
}) {
  const t = useT();
  const { type, timeZone: firmTimeZone } = data;
  const [visitorZone, setVisitorZone] = useState(firmTimeZone);
  useEffect(() => { setVisitorZone(browserZone(firmTimeZone)); }, [firmTimeZone]);
  const [step, setStep] = useState<"pick" | "form" | "done">(initial?.step ?? "pick");
  const [enquiryType, setEnquiryType] = useState("");
  const [slot, setSlot] = useState<PublicSlot | null>(initial?.slot ?? null);
  const [reloadKey, setReloadKey] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [country, setCountry] = useState(data.defaultCountryCode ?? "");
  const [consents, setConsents] = useState({ whatsapp: false, email: false, sms: false });
  const [serviceConsent, setServiceConsent] = useState(false);
  const [requestId] = useState(() => crypto.randomUUID());
  const [openedAt] = useState(() => Date.now());
  const [website, setWebsite] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [taken, setTaken] = useState<PublicSlot[] | null>(null);
  const [result, setResult] = useState<BookingResult | null>(initial?.result ?? null);
  const set = (field: string, value: string) => setAnswers((previous) => ({ ...previous, [field]: value, ...(field === "emirate" ? { area: "" } : {}) }));
  const needsType = type.asksEnquiryType;
  const asked = type.questions.filter((question) => question.field !== "serviceType");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!slot) return;
    if (!serviceConsent) { setError(t("Confirm that we may contact you about this booking.")); return; }
    setSaving(true); setError("");
    try {
      const response = await fetch(`/api/book/${workspace}/${type.slug}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId, start: slot.start, timeZone: visitorZone, ...(enquiryType ? { enquiryType } : {}),
          answers: { ...answers, mobileCountryCode: country }, consents, serviceConsent, ...(link ? { link } : {}), elapsedMs: Date.now() - openedAt, ...(website ? { website } : {}) }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 409 && body.code === "slot_taken") {
        setTaken(Array.isArray(body.nextSlots) ? body.nextSlots : []); setSlot(null); setStep("pick"); setReloadKey((key) => key + 1);
        return;
      }
      if (!response.ok) throw new Error(Array.isArray(body.message) ? body.message.join(". ") : body.message ?? t("Your booking could not be made. Please try again."));
      setResult(body as BookingResult); setStep("done");
    } catch (failure) { setError(failure instanceof Error ? translateKnown(t, failure.message) : t("Please try again.")); }
    finally { setSaving(false); }
  };

  const header = <header className={styles.heading}>
    {data.branding.displayName || data.branding.logoUrl ? <div className={styles.brand}>{data.branding.logoUrl
      ? <Image src={data.branding.logoUrl} alt={t("{name} logo", { name: data.branding.displayName })} width={140} height={56} unoptimized />
      : <span>{data.branding.displayName}</span>}</div> : null}
    <h1>{type.name}</h1>
    <BookingFacts durationMinutes={type.durationMinutes} locationKind={type.locationKind} locationDetail={type.locationDetail} visitorZone={visitorZone} firmTimeZone={firmTimeZone} />
  </header>;

  return <main className={styles.page} data-embedded={embedded || undefined}>
    <div className={styles.panel}>
      {header}
      {step === "pick" ? <>
        {taken ? <Callout tone="warning" title={t("That time was just taken")}>{taken.length ? t("Choose another time below.") : t("Choose another day.")}</Callout> : null}
        {needsType ? <SelectField label={t("What is the meeting about?")} isRequired items={data.options.enquiryTypes} selectedKey={enquiryType || null}
          onSelectionChange={(key) => { setEnquiryType(String(key ?? "")); setSlot(null); }} /> : null}
        {!needsType || enquiryType ? <SlotPicker workspace={workspace} typeSlug={type.slug} firmTimeZone={firmTimeZone} visitorZone={visitorZone} windowDays={type.windowDays}
          enquiryType={enquiryType || undefined} value={slot} onChange={(next) => { setSlot(next); setTaken(null); }} slots={reloadKey ? undefined : slots} reloadKey={reloadKey} /> : null}
        <div className={styles.footer}>
          <Button variant="primary" isDisabled={!slot} onPress={() => setStep("form")}>{t("Next")}</Button>
        </div>
      </> : null}

      {step === "form" && slot ? <Form className={styles.form} onSubmit={submit}>
        <ChosenTime slot={slot} visitorZone={visitorZone} firmTimeZone={firmTimeZone} action={<Button variant="quiet" onPress={() => setStep("pick")}>{t("Change")}</Button>} />
        <TextInput label={t("Your name")} isRequired autoComplete="name" value={answers.displayName ?? ""} onChange={(value) => set("displayName", value)} />
        <PhoneField label={t("Mobile number")} isRequired value={answers.mobile ?? ""} onChange={(value) => set("mobile", value)} countryCode={country} onCountryChange={setCountry} locale={data.locale} />
        <TextInput label={t("Email address")} isRequired inputType="email" autoComplete="email" value={answers.email ?? ""} onChange={(value) => set("email", value)} />
        {type.locationKind === "client_address" ? <TextAreaField label={t("Address for the visit")} isRequired value={answers.address ?? ""} onChange={(value) => set("address", value)} /> : null}
        {asked.map((question) => {
          const label = t(QUESTION_LABELS[question.field]);
          if (question.field === "emirate" && data.options.regions.length) return <SelectField key={question.field} label={label} isRequired={question.required} items={data.options.regions} selectedKey={answers.emirate || null} onSelectionChange={(key) => set("emirate", String(key ?? ""))} />;
          if (question.field === "area" && (data.options.areas[answers.emirate ?? ""] ?? []).length) return <SelectField key={question.field} label={label} isRequired={question.required} items={data.options.areas[answers.emirate ?? ""]} selectedKey={answers.area || null} onSelectionChange={(key) => set("area", String(key ?? ""))} />;
          if (question.field === "budgetRange") return <SelectField key={question.field} label={label} isRequired={question.required} items={data.options.budgetRanges} selectedKey={answers.budgetRange || null} onSelectionChange={(key) => set("budgetRange", String(key ?? ""))} />;
          if (question.field === "summary") return <TextAreaField key={question.field} label={label} isRequired={question.required} value={answers.summary ?? ""} onChange={(value) => set("summary", value)} />;
          if (question.field === "emirate") return null;
          return <TextInput key={question.field} label={label} isRequired={question.required} value={answers[question.field] ?? ""} onChange={(value) => set(question.field, value)} />;
        })}
        <fieldset className={styles.consents}>
          <legend>{t("Send me confirmations and reminders by")}</legend>
          <Checkbox isSelected={consents.whatsapp} onChange={(value) => setConsents((current) => ({ ...current, whatsapp: value }))}>{t("WhatsApp")}</Checkbox>
          <Checkbox isSelected={consents.email} onChange={(value) => setConsents((current) => ({ ...current, email: value }))}>{t("Email")}</Checkbox>
          <Checkbox isSelected={consents.sms} onChange={(value) => setConsents((current) => ({ ...current, sms: value }))}>{t("SMS")}</Checkbox>
        </fieldset>
        <Checkbox isRequired isSelected={serviceConsent} onChange={setServiceConsent}>{t("I agree to be contacted about this booking.")}</Checkbox>
        <div aria-hidden="true" className={styles.trap}><label>{t("Website")}<input tabIndex={-1} autoComplete="off" name="website" value={website} onChange={(event) => setWebsite(event.target.value)} /></label></div>
        {error ? <Callout tone="danger" title={t("Not booked")}>{error}</Callout> : null}
        <div className={styles.footer}>
          <Button variant="quiet" onPress={() => setStep("pick")}>{t("Back")}</Button>
          <Button variant="primary" type="submit" isLoading={saving} isDisabled={!serviceConsent}>{type.confirmation === "approval" ? t("Request booking") : t("Book")}</Button>
        </div>
      </Form> : null}

      {step === "done" && result ? <section className={styles.done} role="status">
        <CircleCheck size={40} aria-hidden="true" />
        {result.status === "received" ? <h2>{t("Thank you")}</h2> : <>
          <h2>{result.status === "pending" ? t("Request sent") : t("You're booked")}</h2>
          {result.status === "pending" ? <p>{t("We will confirm your time shortly.")}</p> : null}
          {slot ? <ChosenTime slot={slot} visitorZone={visitorZone} firmTimeZone={firmTimeZone} /> : null}
          {result.manageToken ? <div className={styles.doneActions}>
            <a className={styles.linkButton} data-primary href={`/api/book/${workspace}/manage/${result.manageToken}/ics`} download="booking.ics"><CalendarPlus size={15} aria-hidden="true" />{t("Add to calendar")}</a>
            <a className={styles.linkButton} href={`/book/${workspace}/manage/${result.manageToken}`} target={embedded ? "_blank" : undefined} rel={embedded ? "noreferrer" : undefined}>{t("Reschedule or cancel")}</a>
          </div> : null}
          <p>{t("A confirmation is on its way to your email.")}</p>
        </>}
      </section> : null}
      <p className={styles.powered}>{t("Powered by Wodana")}</p>
    </div>
  </main>;
}
