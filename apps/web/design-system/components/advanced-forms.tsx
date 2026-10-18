"use client";

import { useT } from "@/lib/i18n/i18n-provider";
import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from "react";
/* eslint-disable @next/next/no-img-element -- crop previews intentionally use local object/data URLs */
import { Eye, EyeOff, File, Link2, Plus, X } from "lucide-react";
import { Button, IconButton } from "./actions";
import { ComboboxField, FieldStack, NumericInput, SelectField, TextInput, type SelectItem, type TextInputProps } from "./forms";
import { useDesignSystem } from "../foundations/provider";

export const EmailInput = (props: Omit<TextInputProps, "inputType">) => <TextInput {...props} inputType="email" />;
export const PhoneInput = (props: Omit<TextInputProps, "inputType">) => <TextInput {...props} inputType="tel" />;
export const UrlInput = (props: Omit<TextInputProps, "inputType" | "prefix">) => <TextInput {...props} inputType="url" prefix={<Link2 size={14} />} />;

export function PasswordInput(props: Omit<TextInputProps, "inputType" | "suffix">) { const t = useT(); const [visible, setVisible] = useState(false); return <TextInput {...props} inputType={visible ? "text" : "password"} suffix={<button aria-label={visible ? t("Hide password") : t("Show password")} className="wd-affix-button" onClick={() => setVisible((value) => !value)} type="button">{visible ? <EyeOff size={14} /> : <Eye size={14} />}</button>} />; }

export function OtpInput({ length = 6, onChange, value = "" }: { length?: number; onChange?: (value: string) => void; value?: string }) {
  const t = useT();
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length }, (_, index) => value[index] ?? "");
  const setDigit = (index: number, digit: string) => { const next = [...digits]; next[index] = digit.replace(/\D/g, "").slice(-1); onChange?.(next.join("")); if (digit && index < length - 1) refs.current[index + 1]?.focus(); };
  const paste = (event: ClipboardEvent) => { event.preventDefault(); onChange?.(event.clipboardData.getData("text").replace(/\D/g, "").slice(0, length)); };
  const keyDown = (event: KeyboardEvent<HTMLInputElement>, index: number) => { if (event.key === "Backspace" && !digits[index] && index > 0) refs.current[index - 1]?.focus(); if (event.key === "ArrowLeft") refs.current[Math.max(0, index - 1)]?.focus(); if (event.key === "ArrowRight") refs.current[Math.min(length - 1, index + 1)]?.focus(); };
  return <div aria-label={t("One-time password")} className="wd-otp" onPaste={paste} role="group">{digits.map((digit, index) => <input aria-label={t("Digit {number}", { number: index + 1 })} autoComplete={index === 0 ? "one-time-code" : "off"} inputMode="numeric" key={index} maxLength={1} onChange={(event) => setDigit(index, event.target.value)} onKeyDown={(event) => keyDown(event, index)} ref={(element) => { refs.current[index] = element; }} value={digit} />)}</div>;
}

export function MaskedInput({ format, ...props }: Omit<TextInputProps, "onChange"> & { format: (raw: string) => string; onChange?: (value: string) => void }) { const [value, setValue] = useState(String(props.value ?? "")); return <TextInput {...props} onChange={(raw) => { const formatted = format(raw); setValue(formatted); props.onChange?.(formatted); }} value={value} />; }

export function DurationInput({ label, onChange, value = 0 }: { label: string; onChange?: (minutes: number) => void; value?: number }) {
  const t = useT(); const hours = Math.floor(value / 60); const minutes = value % 60; return <div className="wd-duration-field"><span className="wd-field-label">{label}</span><div><NumericInput aria-label={t("Hours")} label={<span className="wd-visually-hidden">{t("Hours")}</span>} minValue={0} onChange={(next) => onChange?.(next * 60 + minutes)} suffix="h" value={hours} /><NumericInput aria-label={t("Minutes")} label={<span className="wd-visually-hidden">{t("Minutes")}</span>} maxValue={59} minValue={0} onChange={(next) => onChange?.(hours * 60 + next)} suffix="m" value={minutes} /></div></div>; }

export function TimeInput({ label, onChange, value }: { label: string; onChange?: (value: string) => void; value?: string }) { return <label className="wd-native-field"><span className="wd-field-label">{label}</span><input onChange={(event) => onChange?.(event.target.value)} type="time" value={value} /></label>; }
export function DateTimeInput({ isDisabled = false, label, onChange, value }: { isDisabled?: boolean; label: string; onChange?: (value: string) => void; value?: string }) { return <label className="wd-native-field"><span className="wd-field-label">{label}</span><input disabled={isDisabled} onChange={(event) => onChange?.(event.target.value)} type="datetime-local" value={value} /></label>; }

export function RecurrenceField({ onChange, value = "none" }: { onChange?: (value: string) => void; value?: string }) {
  const t = useT(); return <SelectField items={[{ id: "none", label: t("Does not repeat") }, { id: "daily", label: t("Daily") }, { id: "weekly", label: t("Weekly") }, { id: "monthly", label: t("Monthly") }, { id: "custom", label: t("Custom…") }]} label={t("Repeat")} onSelectionChange={(key) => onChange?.(String(key))} selectedKey={value} />; }
export function TimeZoneField({ items, onChange, value }: { items?: SelectItem[]; onChange?: (value: string) => void; value?: string }) {
  const t = useT(); const { timeZone } = useDesignSystem(); const zones = (Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? []; return <ComboboxField items={items ?? [...new Set([timeZone, ...zones])].map((id) => ({ id, label: id.replaceAll("_", " ") }))} label={t("Time zone")} onSelectionChange={(key) => onChange?.(String(key))} selectedKey={value} />; }

export const UserPicker = (props: React.ComponentProps<typeof ComboboxField>) => <ComboboxField {...props} />;
export const VendorPicker = (props: React.ComponentProps<typeof ComboboxField>) => <ComboboxField {...props} />;
export const MaterialPicker = (props: React.ComponentProps<typeof ComboboxField>) => <ComboboxField {...props} />;

export function CharacterCount({ max, value }: { max: number; value: string }) { return <span aria-live="polite" className="wd-character-count" data-over={value.length > max || undefined}>{value.length}/{max}</span>; }


export function RichTextEditor({ label, onChange, value = "" }: { label: string; onChange?: (value: string) => void; value?: string }) {
  const t = useT(); const ref = useRef<HTMLDivElement>(null); useEffect(() => { if (ref.current && ref.current.innerHTML !== value) ref.current.innerHTML = value; }, [value]); const command = (name: string) => { document.execCommand(name); ref.current?.focus(); }; return <div className="wd-rich-text"><span className="wd-field-label">{label}</span><div className="wd-rich-toolbar"><button aria-label={t("Bold")} onClick={() => command("bold")} type="button"><strong>B</strong></button><button aria-label={t("Italic")} onClick={() => command("italic")} type="button"><em>I</em></button><button aria-label={t("Bulleted list")} onClick={() => command("insertUnorderedList")} type="button">• {t("List")}</button></div><div aria-label={label} contentEditable ref={ref} role="textbox" onInput={(event) => onChange?.(event.currentTarget.innerHTML)} suppressContentEditableWarning /></div>; }

export function MentionInput({ people, value, onChange }: { people: SelectItem[]; value: string; onChange?: (value: string) => void }) {
  const t = useT(); const [open, setOpen] = useState(false); return <div className="wd-mention-input"><textarea aria-label={t("Comment with mentions")} onChange={(event) => { onChange?.(event.target.value); setOpen(event.target.value.endsWith("@")); }} placeholder={t("Write a comment or type @ to mention")} value={value} />{open ? <div>{people.map((person) => <button key={person.id} onClick={() => { onChange?.(`${value}${person.label} `); setOpen(false); }} type="button">{person.label}</button>)}</div> : null}</div>; }

export type Attachment = { id: string; name: string; size?: string; href?: string };
export function AttachmentList({ items, onRemove }: { items: Attachment[]; onRemove?: (item: Attachment) => void }) { const t = useT(); return <div className="wd-attachment-list">{items.map((item) => <div key={item.id}><File size={14} /><a href={item.href}>{item.name}</a>{item.size ? <small>{item.size}</small> : null}{onRemove ? <IconButton aria-label={t("Remove {name}", { name: item.name })} onPress={() => onRemove(item)} size="compact"><X size={13} /></IconButton> : null}</div>)}</div>; }

export function ImageCropper({ alt, src, onConfirm }: { alt: string; src: string; onConfirm?: (zoom: number) => void }) {
  const t = useT(); const [zoom, setZoom] = useState(1); return <div className="wd-image-cropper"><div><img alt={alt} src={src} style={{ transform: `scale(${zoom})` }} /></div><label>{t("Zoom")}<input max={2.5} min={1} onChange={(event) => setZoom(Number(event.target.value))} step={0.1} type="range" value={zoom} /></label><Button onPress={() => onConfirm?.(zoom)} variant="primary">{t("Use image")}</Button></div>; }

export function SignatureField({ label, onClear }: { label: string; onClear?: () => void }) {
  const t = useT(); const canvas = useRef<HTMLCanvasElement>(null); const drawing = useRef(false); const point = (event: React.PointerEvent<HTMLCanvasElement>) => { const context = canvas.current?.getContext("2d"); if (!context) return; const rect = event.currentTarget.getBoundingClientRect(); const x = event.clientX - rect.left; const y = event.clientY - rect.top; if (!drawing.current) { context.beginPath(); context.moveTo(x, y); } else { context.lineTo(x, y); context.stroke(); } }; const clear = () => { const context = canvas.current?.getContext("2d"); if (context && canvas.current) context.clearRect(0, 0, canvas.current.width, canvas.current.height); onClear?.(); }; return <div className="wd-signature"><span className="wd-field-label">{label}</span><canvas aria-label={label} height={140} onPointerDown={(event) => { drawing.current = true; point(event); }} onPointerMove={point} onPointerUp={() => { drawing.current = false; }} ref={canvas} role="img" width={520} /><Button onPress={clear} size="compact">{t("Clear signature")}</Button></div>; }

export function RepeatablePropertyList({ children, onAdd }: { children: ReactNode; onAdd?: () => void }) {
  const t = useT(); return <FieldStack>{children}<Button onPress={onAdd}><Plus size={14} />{t("Add another")}</Button></FieldStack>; }
