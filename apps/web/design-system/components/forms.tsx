"use client";

import { useT } from "@/lib/i18n/i18n-provider";
import { useId, useRef, useState, type ChangeEvent, type FormHTMLAttributes, type ReactNode, type Ref } from "react";
import {
  Button as AriaButton,
  Calendar,
  type CalendarProps,
  CalendarCell,
  CalendarGrid,
  Checkbox as AriaCheckbox,
  ComboBox,
  DateInput,
  DatePicker,
  TimeField as AriaTimeField,
  type TimeFieldProps,
  type TimeValue,
  DateRangePicker,
  DateSegment,
  FieldError,
  Group,
  Heading,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  NumberField,
  Popover,
  Radio,
  RadioGroup,
  RangeCalendar,
  SearchField,
  Select,
  SelectValue,
  Switch as AriaSwitch,
  Text,
  TextArea,
  TextField,
  type ComboBoxProps,
  type ButtonProps as AriaButtonProps,
  type DatePickerProps,
  type DateRangePickerProps,
  type Key,
  type NumberFieldProps,
  type RadioGroupProps,
  type SelectProps,
  type TextFieldProps,
} from "react-aria-components";
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Paperclip, Search, Upload, X } from "lucide-react";
import type { DateValue } from "@internationalized/date";
import { useDesignSystem, usePortalThemeAttributes } from "../foundations/provider";
import { Tag } from "./status";
import { Button, IconButton } from "./actions";

type FieldChromeProps = {
  description?: ReactNode;
  errorMessage?: ReactNode;
  isRequired?: boolean;
  label: ReactNode;
};

function FieldLabel({ label, required }: { label: ReactNode; required?: boolean }) {
  return <Label className="wd-field-label">{label}{required ? <span aria-hidden="true"> *</span> : null}</Label>;
}

// The error slot is always present: React Aria shows it only while the field is invalid, so a
// blocked save (for example an empty required dropdown) is never silent.
function FieldMeta({ description, errorMessage }: { description?: ReactNode; errorMessage?: ReactNode }) {
  const t = useT();
  return <>{description ? <Text className="wd-field-help" slot="description">{description}</Text> : null}<FieldError className="wd-field-error">{({ validationDetails, validationErrors }) => <><CircleAlert aria-hidden="true" size={14} />{errorMessage ?? (validationDetails?.valueMissing ? t("Required") : validationErrors.join(" ") || t("Check this field"))}</>}</FieldError></>;
}

export type TextInputProps = TextFieldProps & FieldChromeProps & { prefix?: ReactNode; suffix?: ReactNode; inputType?: "text" | "email" | "password" | "url" | "tel" | "date" | "datetime-local" | "time"; placeholder?: string };
export function TextInput({ description, errorMessage, inputType = "text", isRequired, label, placeholder, prefix, suffix, ...props }: TextInputProps) {
  return <TextField {...props} className="wd-field" isRequired={isRequired}><FieldLabel label={label} required={isRequired} /><Group className="wd-input-group wd-focus-frame">{prefix ? <span className="wd-input-affix" data-side="start">{prefix}</span> : null}<Input className="wd-input" placeholder={placeholder} type={inputType} />{suffix ? <span className="wd-input-affix" data-side="end">{suffix}</span> : null}</Group><FieldMeta description={description} errorMessage={errorMessage} /></TextField>;
}

export function TextAreaField({ description, errorMessage, isRequired, label, placeholder, ...props }: TextFieldProps & FieldChromeProps & { placeholder?: string }) {
  return <TextField {...props} className="wd-field" isRequired={isRequired}><FieldLabel label={label} required={isRequired} /><span className="wd-textarea-frame wd-focus-frame"><TextArea className="wd-textarea" placeholder={placeholder} /></span><FieldMeta description={description} errorMessage={errorMessage} /></TextField>;
}

export function SearchInput({ inputRef, label = "Search", placeholder, ...props }: Omit<TextFieldProps, "children"> & { inputRef?: Ref<HTMLInputElement>; label?: string; placeholder?: string }) {
  return <SearchField {...props} className="wd-search-field wd-focus-frame"><Label className="wd-visually-hidden">{label}</Label><Search aria-hidden="true" size={15} /><Input className="wd-input" placeholder={placeholder ?? label} ref={inputRef} /><AriaButton aria-label="Clear search"><X size={14} /></AriaButton></SearchField>;
}

export function NumericInput({ description, errorMessage, isRequired, label, prefix, suffix, ...props }: NumberFieldProps & FieldChromeProps & { prefix?: ReactNode; suffix?: ReactNode }) {
  return <NumberField {...props} className="wd-field" isRequired={isRequired}><FieldLabel label={label} required={isRequired} /><Group className="wd-input-group wd-focus-frame">{prefix ? <span className="wd-input-affix" data-side="start">{prefix}</span> : null}<Input className="wd-input" inputMode="decimal" />{suffix ? <span className="wd-input-affix" data-side="end">{suffix}</span> : null}</Group><FieldMeta description={description} errorMessage={errorMessage} /></NumberField>;
}

export function InputAction({ children, className, ...props }: AriaButtonProps) {
  return <AriaButton {...props} className={(state) => ["wd-input-action", typeof className === "function" ? className(state) : className].filter(Boolean).join(" ")}>{children}</AriaButton>;
}

export const MoneyInput = (props: Omit<React.ComponentProps<typeof NumericInput>, "prefix"> & { currency?: string }) => <NumericInput {...props} prefix={props.currency ?? "INR"} />;
export const PercentageInput = (props: Omit<React.ComponentProps<typeof NumericInput>, "suffix">) => <NumericInput {...props} maxValue={props.maxValue ?? 100} minValue={props.minValue ?? 0} suffix="%" />;
export const QuantityInput = (props: Omit<React.ComponentProps<typeof NumericInput>, "suffix"> & { unit?: string }) => <NumericInput {...props} suffix={props.unit ?? "nos"} />;
export const MeasurementInput = (props: Omit<React.ComponentProps<typeof NumericInput>, "suffix"> & { unit?: string }) => <NumericInput {...props} suffix={props.unit ?? "mm"} />;

export function Checkbox({ children, ...props }: React.ComponentProps<typeof AriaCheckbox>) {
  return <AriaCheckbox {...props} className="wd-checkbox">{(values) => <><span aria-hidden="true" className="wd-checkbox-box"><Check size={13} /></span>{typeof children === "function" ? children(values) : children}</>}</AriaCheckbox>;
}

export function Switch({ children, ...props }: React.ComponentProps<typeof AriaSwitch>) {
  return <AriaSwitch {...props} className="wd-switch">{(values) => <><span aria-hidden="true" className="wd-switch-track"><span /></span>{typeof children === "function" ? children(values) : children}</>}</AriaSwitch>;
}

export function RadioSet({ description, errorMessage, items, label, ...props }: RadioGroupProps & FieldChromeProps & { items: Array<{ id: string; label: ReactNode; description?: ReactNode }> }) {
  return <RadioGroup {...props} className="wd-field"><FieldLabel label={label} required={props.isRequired} /><div className="wd-choice-list">{items.map((item) => <Radio className="wd-radio" id={item.id} key={item.id} value={item.id}><span aria-hidden="true" className="wd-radio-dot" /><span><strong>{item.label}</strong>{item.description ? <small>{item.description}</small> : null}</span></Radio>)}</div><FieldMeta description={description} errorMessage={errorMessage} /></RadioGroup>;
}

export type SelectItem = { id: string; label: string; description?: string; icon?: ReactNode };
/** Lists longer than this become type-to-filter: one dropdown, with search only where it helps. */
const LONG_LIST = 10;

export function SelectField({ accent = "brand", description, errorMessage, items, label, prefix, placeholder = "Select an option", ...props }: SelectProps<object> & FieldChromeProps & { accent?: "brand" | "neutral"; prefix?: ReactNode; items: SelectItem[] }) {
  if (items.length > LONG_LIST) {
    const { selectedKey, defaultSelectedKey, onSelectionChange, isRequired, isDisabled, isInvalid, autoFocus, name, validate, ...rest } = props;
    return <ComboboxField aria-label={rest["aria-label"]} autoFocus={autoFocus} defaultSelectedKey={defaultSelectedKey} description={description} errorMessage={errorMessage}
      isDisabled={isDisabled} isInvalid={isInvalid} isRequired={isRequired} items={items} label={label} name={name}
      onSelectionChange={onSelectionChange} prefix={prefix} selectedKey={selectedKey} validate={validate as never} />;
  }
  return <SelectList accent={accent} description={description} errorMessage={errorMessage} items={items} label={label} prefix={prefix} placeholder={placeholder} {...props} />;
}

function SelectList({ accent = "brand", description, errorMessage, items, label, prefix, placeholder = "Select an option", ...props }: SelectProps<object> & FieldChromeProps & { accent?: "brand" | "neutral"; prefix?: ReactNode; items: SelectItem[] }) {
  const { portalContainer, direction } = useDesignSystem();
  const portalTheme = usePortalThemeAttributes();
  return <Select {...props} className="wd-field" data-accent={accent} placeholder={placeholder}><FieldLabel label={label} required={props.isRequired} /><AriaButton className="wd-select-button wd-focus-frame">{prefix ? <span className="wd-select-prefix" aria-hidden="true">{prefix}</span> : null}<SelectValue className="wd-select-value">{({ isPlaceholder, selectedText }) => isPlaceholder ? placeholder : selectedText}</SelectValue><span aria-hidden="true" className="wd-select-indicator"><ChevronDown size={15} /></span></AriaButton><FieldMeta description={description} errorMessage={errorMessage} /><Popover {...portalTheme} UNSTABLE_portalContainer={portalContainer ?? undefined} className="wd-popover wd-picker-popover" data-accent={accent} dir={direction}><ListBox items={items}>{(item) => <ListBoxItem className="wd-picker-item" id={item.id} textValue={item.label}><span>{item.label}</span>{item.description ? <small>{item.description}</small> : null}<Check aria-hidden="true" className="wd-picker-check" size={14} /></ListBoxItem>}</ListBox></Popover></Select>;
}

export function ComboboxField({ description, errorMessage, items, label, placeholder, prefix, ...props }: ComboBoxProps<object> & FieldChromeProps & { items: SelectItem[]; placeholder?: string; prefix?: ReactNode }) {
  const { portalContainer, direction } = useDesignSystem();
  const portalTheme = usePortalThemeAttributes();
  const t = useT();
  // Opens on click with the whole list; typing filters. Focus selects the current text so typing replaces it.
  // "No matches" shows only when a real list is filtered to nothing; an empty source (still loading) stays closed.
  return <ComboBox allowsEmptyCollection={items.length > 0} menuTrigger="focus" {...props} className="wd-field wd-combobox"><FieldLabel label={label} required={props.isRequired} /><Group className="wd-input-group wd-focus-frame">{prefix ? <span className="wd-input-affix" data-side="start" aria-hidden="true">{prefix}</span> : null}<Input className="wd-input" onFocus={(event) => event.currentTarget.select()} placeholder={placeholder ?? t("Type to search")} /><AriaButton aria-label={t("Show options")} className="wd-input-icon-button"><ChevronDown size={15} /></AriaButton></Group><FieldMeta description={description} errorMessage={errorMessage} /><Popover {...portalTheme} UNSTABLE_portalContainer={portalContainer ?? undefined} className="wd-popover wd-picker-popover" dir={direction}><ListBox items={items} renderEmptyState={() => <p className="wd-picker-empty">{t("No matches")}</p>}>{(item) => <ListBoxItem className="wd-picker-item" id={item.id} textValue={item.label}>{item.icon ? <span className="wd-option-icon" aria-hidden="true">{item.icon}</span> : null}<span>{item.label}</span>{item.description ? <small>{item.description}</small> : null}<Check aria-hidden="true" className="wd-picker-check" size={14} /></ListBoxItem>}</ListBox></Popover></ComboBox>;
}

export function MultiSelectField({ label, items, selectedKeys, onSelectionChange }: { label: string; items: SelectItem[]; selectedKeys: Set<Key>; onSelectionChange: (keys: Set<Key>) => void }) {
  const available = items.filter((item) => !selectedKeys.has(item.id));
  return <div aria-label={label} className="wd-field" role="group"><span className="wd-field-label">{label}</span><div className="wd-multi-select">{items.filter((item) => selectedKeys.has(item.id)).map((item) => <Tag key={item.id} onRemove={() => { const next = new Set(selectedKeys); next.delete(item.id); onSelectionChange(next); }}>{item.label}</Tag>)}<ComboboxField aria-label={`Add ${label}`} items={available} label={<span className="wd-visually-hidden">Add {label}</span>} onSelectionChange={(key) => { if (key) onSelectionChange(new Set([...selectedKeys, key])); }} placeholder="Add…" /></div></div>;
}

function CalendarHeader() { return <header className="wd-calendar-header"><AriaButton aria-label="Previous month" slot="previous"><ChevronLeft data-directional="true" size={15} /></AriaButton><Heading /><AriaButton aria-label="Next month" slot="next"><ChevronRight data-directional="true" size={15} /></AriaButton></header>; }
type CalendarStart={firstDayOfWeek?:CalendarProps<DateValue>['firstDayOfWeek']};
function CalendarBody({firstDayOfWeek}:CalendarStart) { return <Calendar firstDayOfWeek={firstDayOfWeek} className="wd-calendar"><CalendarHeader /><CalendarGrid>{(date) => <CalendarCell className="wd-calendar-cell" date={date} />}</CalendarGrid></Calendar>; }
function RangeCalendarBody() { return <RangeCalendar className="wd-calendar"><CalendarHeader /><CalendarGrid>{(date) => <CalendarCell className="wd-calendar-cell" date={date} />}</CalendarGrid></RangeCalendar>; }

export function DateField({ description, errorMessage, label, firstDayOfWeek, ...props }: DatePickerProps<DateValue> & FieldChromeProps & CalendarStart) {
  const { portalContainer, direction } = useDesignSystem();
  const portalTheme = usePortalThemeAttributes();
  return <DatePicker {...props} className="wd-field"><FieldLabel label={label} required={props.isRequired} /><Group className="wd-date-group wd-focus-frame"><DateInput className="wd-date-input">{(segment) => <DateSegment className="wd-date-segment" segment={segment} />}</DateInput><AriaButton aria-label="Open calendar"><CalendarDays size={15} /></AriaButton></Group><FieldMeta description={description} errorMessage={errorMessage} /><Popover {...portalTheme} UNSTABLE_portalContainer={portalContainer ?? undefined} className="wd-popover wd-calendar-popover" dir={direction}><DialogCalendar firstDayOfWeek={firstDayOfWeek}/></Popover></DatePicker>;
}

export function TimeField({ description, errorMessage, label, ...props }: TimeFieldProps<TimeValue> & FieldChromeProps) {
  return <AriaTimeField {...props} className="wd-field"><FieldLabel label={label} required={props.isRequired} /><DateInput className="wd-date-group wd-date-input wd-time-input wd-focus-frame">{segment => <DateSegment className="wd-date-segment" segment={segment} />}</DateInput><FieldMeta description={description} errorMessage={errorMessage} /></AriaTimeField>;
}

function DialogCalendar({firstDayOfWeek}:CalendarStart) { return <div role="dialog"><CalendarBody firstDayOfWeek={firstDayOfWeek}/></div>; }

export function DateRangeField({ description, errorMessage, label, ...props }: DateRangePickerProps<DateValue> & FieldChromeProps) {
  const { portalContainer, direction } = useDesignSystem();
  const portalTheme = usePortalThemeAttributes();
  return <DateRangePicker {...props} className="wd-field"><FieldLabel label={label} required={props.isRequired} /><Group className="wd-date-group wd-focus-frame"><DateInput className="wd-date-input" slot="start">{(segment) => <DateSegment className="wd-date-segment" segment={segment} />}</DateInput><span aria-hidden="true">–</span><DateInput className="wd-date-input" slot="end">{(segment) => <DateSegment className="wd-date-segment" segment={segment} />}</DateInput><AriaButton aria-label="Open calendar"><CalendarDays size={15} /></AriaButton></Group><FieldMeta description={description} errorMessage={errorMessage} /><Popover {...portalTheme} UNSTABLE_portalContainer={portalContainer ?? undefined} className="wd-popover wd-calendar-popover" dir={direction}><div role="dialog"><RangeCalendarBody /></div></Popover></DateRangePicker>;
}

/**
 * A list of short values (categories, tags): type and press Enter or a comma to add, Backspace on an
 * empty box to remove the last. Known values are suggested; case differences don't make duplicates.
 */
export function TagsField({ description, isReadOnly = false, label, onChange, placeholder, suggestions = [], values }: {
  description?: ReactNode; isReadOnly?: boolean; label: string; onChange: (values: string[]) => void; placeholder?: string; suggestions?: string[]; values: string[];
}) {
  const [draft, setDraft] = useState("");
  const listId = useId();
  const has = (value: string) => values.some((item) => item.toLocaleLowerCase() === value.toLocaleLowerCase());
  const add = (value: string) => {
    const text = value.replace(/\s+/g, " ").trim();
    setDraft("");
    if (!text || has(text)) return;
    onChange([...values, suggestions.find((item) => item.toLocaleLowerCase() === text.toLocaleLowerCase()) ?? text]);
  };
  const options = suggestions.filter((item) => !has(item)).slice(0, 50);
  return <div className="wd-field wd-tags-field">
    <span className="wd-field-label" aria-hidden="true">{label}</span>
    <div className="wd-tags-input wd-focus-frame" data-readonly={isReadOnly || undefined}>
      {values.map((value) => <Tag key={value} onRemove={isReadOnly ? undefined : () => onChange(values.filter((item) => item !== value))}>{value}</Tag>)}
      {isReadOnly ? null : <input aria-label={label} className="wd-tags-draft" list={listId} placeholder={values.length ? undefined : placeholder} value={draft}
        onBlur={() => add(draft)} onChange={(event) => { const next = event.target.value; if (/[,\n]$/.test(next)) add(next.slice(0, -1)); else setDraft(next); }}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); add(draft); }
          else if (event.key === "Backspace" && !draft && values.length) onChange(values.slice(0, -1));
        }} />}
      <datalist id={listId}>{options.map((item) => <option key={item} value={item} />)}</datalist>
    </div>
    {description ? <span className="wd-field-help">{description}</span> : null}
  </div>;
}

export function FieldStack({ children }: { children: ReactNode }) { return <div className="wd-field-stack">{children}</div>; }

export function PropertyRow({ children, description, label }: { children: ReactNode; description?: ReactNode; label: ReactNode }) {
  return <div className="wd-property-row"><div><span className="wd-field-label">{label}</span>{description ? <small>{description}</small> : null}</div><div>{children}</div></div>;
}

export type UploadFile = { id: string; file: File; progress: number; status: "queued" | "uploading" | "complete" | "error" };
export function FileUploader({ accept, appearance = "dropzone", label = "Upload files", multiple = true, onFiles }: { accept?: string; appearance?: "dropzone" | "button"; label?: string; multiple?: boolean; onFiles?: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<UploadFile[]>([]);
  const addFiles = (nextFiles: File[]) => { setFiles((current) => [...current, ...nextFiles.map((file) => ({ id: `${file.name}-${file.lastModified}`, file, progress: 100, status: "complete" as const }))]); onFiles?.(nextFiles); };
  const change = (event: ChangeEvent<HTMLInputElement>) => addFiles(Array.from(event.target.files ?? []));
  return <div className="wd-uploader" data-appearance={appearance}>{appearance === "button"
    ? <Button onPress={() => input.current?.click()} size="compact" variant="quiet"><Upload aria-hidden="true" size={14} />{label}</Button>
    : <button className="wd-drop-zone" onClick={() => input.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); addFiles(Array.from(event.dataTransfer.files)); }} type="button"><Upload aria-hidden="true" size={18} /><strong>{label}</strong><span>Drop files here or choose from your device</span></button>}
    <input accept={accept} aria-label={label} className="wd-visually-hidden" multiple={multiple} onChange={change} ref={input} type="file" />
    {appearance === "dropzone" ? <div className="wd-upload-list">{files.map((item) => <div key={item.id}><Paperclip size={14} /><span>{item.file.name}</span><small>{Math.ceil(item.file.size / 1024)} KB</small><IconButton aria-label={`Remove ${item.file.name}`} onPress={() => setFiles((current) => current.filter((file) => file.id !== item.id))}><X size={13} /></IconButton></div>)}</div> : null}</div>;
}

export function LogoUploader(props: Omit<React.ComponentProps<typeof FileUploader>, "accept" | "multiple">) { return <FileUploader {...props} accept="image/png,image/jpeg,image/webp,image/svg+xml" label={props.label ?? "Upload organization logo"} multiple={false} />; }

export function AutosaveState({ state }: { state: "idle" | "saving" | "saved" | "error" }) { return <span aria-live="polite" className="wd-autosave" data-state={state}>{state === "saving" ? "Saving…" : state === "saved" ? "Saved" : state === "error" ? "Could not save" : ""}</span>; }

export function SegmentedControl({ label, onChange, options, value }: { label: string; onChange: (value: string) => void; options: SelectItem[]; value: string }) { return <div aria-label={label} className="wd-segmented" role="radiogroup">{options.map((option) => <button aria-checked={value === option.id} key={option.id} onClick={() => onChange(option.id)} role="radio" type="button">{option.label}</button>)}</div>; }

export function RepeatableFields<T>({ addLabel = "Add item", items, onAdd, onRemove, renderItem }: { addLabel?: string; items: T[]; onAdd: () => void; onRemove: (index: number) => void; renderItem: (item: T, index: number) => ReactNode }) { return <div className="wd-repeatable"><div>{items.map((item, index) => <div className="wd-repeatable-row" key={index}><div>{renderItem(item, index)}</div><IconButton aria-label={`Remove item ${index + 1}`} onPress={() => onRemove(index)}><X size={14} /></IconButton></div>)}</div><Button onPress={onAdd}>{addLabel}</Button></div>; }

export function Form({ children, className, onSubmit, ...props }: FormHTMLAttributes<HTMLFormElement>) { return <form {...props} className={["wd-form", className].filter(Boolean).join(" ")} onSubmit={onSubmit}>{children}</form>; }
export function Fieldset({ children, description, legend }: { children: ReactNode; description?: ReactNode; legend: ReactNode }) { return <fieldset className="wd-fieldset"><legend>{legend}</legend>{description ? <p>{description}</p> : null}{children}</fieldset>; }
export function ValidationSummary({ errors }: { errors: string[] }) { if (!errors.length) return null; return <div className="wd-validation-summary" role="alert"><strong>Check the highlighted fields</strong><ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul></div>; }
