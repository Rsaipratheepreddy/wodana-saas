"use client";

import { useT } from "@/lib/i18n/i18n-provider";
import { useId, useMemo, useRef, useState, type ChangeEvent, type FormHTMLAttributes, type ReactNode, type Ref } from "react";
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
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Minus, Paperclip, Plus, Search, Upload, X } from "lucide-react";
import type { DateValue } from "@internationalized/date";
import { useDesignSystem, usePortalThemeAttributes } from "../foundations/provider";
import { useReadOnlyReason } from "../foundations/read-only";
import { revealAnchor, useCloseOnAnchorScroll } from "./anchored-popover";
import { DateQuickPicks } from "./date-picks";
import { FormFieldContext, useFormFieldContext, type FormFieldMarkers } from "./form-context";
import { useErrorSummary } from "./form-summary";
import { Tag } from "./status";
import { Button, IconButton, type ControlSize } from "./actions";

type FieldChromeProps = {
  description?: ReactNode;
  errorMessage?: ReactNode;
  isRequired?: boolean;
  label: ReactNode;
};

/**
 * A single-line field's size, from the same scale as buttons: a field and a button of one size are one height. Fields
 * are large (the form height) by default; a toolbar holds its own at its buttons' size.
 */
type FieldSizeProps = { size?: ControlSize };

/**
 * Labels sit above their field. Required fields carry no asterisk: inside a `Form` the others say "Optional"
 * (drawn by CSS from `data-optional`, so the label's text and accessible name stay the label itself).
 */
function FieldLabel({ label, required }: { label: ReactNode; required?: boolean }) {
  const optional = useOptionalMarker(required);
  return <Label className="wd-field-label" data-optional={optional}>{label}</Label>;
}

function useOptionalMarker(required?: boolean) {
  const t = useT();
  const form = useFormFieldContext();
  return form?.markers === "optional" && !required ? t("Optional") : undefined;
}

/** The label of a control that is not a React Aria field (a group of checkboxes, tags, a custom picker). */
export function FieldCaption({ children, id, isRequired }: { children: ReactNode; id?: string; isRequired?: boolean }) {
  const optional = useOptionalMarker(isRequired);
  return <span className="wd-field-label" data-optional={optional} id={id}>{children}</span>;
}

// The error slot is always present: React Aria shows it only while the field is invalid, so a
// blocked save (for example an empty required dropdown) is never silent.
function FieldMeta({ description, errorMessage }: { description?: ReactNode; errorMessage?: ReactNode }) {
  const t = useT();
  return <>{description ? <Text className="wd-field-help" slot="description">{description}</Text> : null}<FieldError className="wd-field-error">{({ validationDetails, validationErrors }) => <><CircleAlert aria-hidden="true" size={14} />{errorMessage ?? (validationDetails?.valueMissing ? t("Required") : validationErrors.join(" ") || t("Check this field"))}</>}</FieldError></>;
}

export type TextInputProps = TextFieldProps & FieldChromeProps & FieldSizeProps & { prefix?: ReactNode; suffix?: ReactNode; inputType?: "text" | "email" | "password" | "url" | "tel" | "date" | "datetime-local" | "time"; placeholder?: string };
export function TextInput({ description, errorMessage, inputType = "text", isRequired, label, placeholder, prefix, size, suffix, ...props }: TextInputProps) {
  return <TextField {...props} className="wd-field" data-size={size} isRequired={isRequired}><FieldLabel label={label} required={isRequired} /><Group className="wd-input-group wd-focus-frame">{prefix ? <span className="wd-input-affix" data-side="start">{prefix}</span> : null}<Input className="wd-input" placeholder={placeholder} type={inputType} />{suffix ? <span className="wd-input-affix" data-side="end">{suffix}</span> : null}</Group><FieldMeta description={description} errorMessage={errorMessage} /></TextField>;
}

export function TextAreaField({ description, errorMessage, isRequired, label, placeholder, ...props }: TextFieldProps & FieldChromeProps & { placeholder?: string }) {
  return <TextField {...props} className="wd-field" isRequired={isRequired}><FieldLabel label={label} required={isRequired} /><span className="wd-textarea-frame wd-focus-frame"><TextArea className="wd-textarea" placeholder={placeholder} /></span><FieldMeta description={description} errorMessage={errorMessage} /></TextField>;
}

export function SearchInput({ inputRef, label: labelProp, placeholder, size, ...props }: Omit<TextFieldProps, "children"> & FieldSizeProps & { inputRef?: Ref<HTMLInputElement>; label?: string; placeholder?: string }) {
  const t = useT();
  const label = labelProp ?? t("Search");
  return <SearchField {...props} className="wd-search-field wd-focus-frame" data-size={size}><Label className="wd-visually-hidden">{label}</Label><Search aria-hidden="true" size={15} /><Input className="wd-input" placeholder={placeholder ?? label} ref={inputRef} /><AriaButton aria-label={t("Clear search")}><X size={14} /></AriaButton></SearchField>;
}

export function NumericInput({ description, errorMessage, isRequired, label, prefix, size, suffix, ...props }: NumberFieldProps & FieldChromeProps & FieldSizeProps & { prefix?: ReactNode; suffix?: ReactNode }) {
  return <NumberField {...props} className="wd-field" data-size={size} isRequired={isRequired}><FieldLabel label={label} required={isRequired} /><Group className="wd-input-group wd-focus-frame">{prefix ? <span className="wd-input-affix" data-side="start">{prefix}</span> : null}<Input className="wd-input" inputMode="decimal" />{suffix ? <span className="wd-input-affix" data-side="end">{suffix}</span> : null}</Group><FieldMeta description={description} errorMessage={errorMessage} /></NumberField>;
}

export function InputAction({ children, className, ...props }: AriaButtonProps) {
  return <AriaButton {...props} className={(state) => ["wd-input-action", typeof className === "function" ? className(state) : className].filter(Boolean).join(" ")}>{children}</AriaButton>;
}

export const MoneyInput = (props: Omit<React.ComponentProps<typeof NumericInput>, "prefix"> & { currency?: string }) => { const { currency } = useDesignSystem(); return <NumericInput {...props} prefix={props.currency ?? currency} />; };
export const PercentageInput = (props: Omit<React.ComponentProps<typeof NumericInput>, "suffix">) => <NumericInput {...props} maxValue={props.maxValue ?? 100} minValue={props.minValue ?? 0} suffix="%" />;
export const QuantityInput = (props: Omit<React.ComponentProps<typeof NumericInput>, "suffix"> & { unit?: string }) => <NumericInput {...props} suffix={props.unit ?? "nos"} />;
export const MeasurementInput = (props: Omit<React.ComponentProps<typeof NumericInput>, "suffix"> & { unit?: string }) => <NumericInput {...props} suffix={props.unit ?? "mm"} />;

export function Checkbox({ children, ...props }: React.ComponentProps<typeof AriaCheckbox>) {
  // A partly selected group shows a dash, not a tick.
  return <AriaCheckbox {...props} className="wd-checkbox">{(values) => <><span aria-hidden="true" className="wd-checkbox-box">{values.isIndeterminate ? <Minus size={13} /> : <Check size={13} />}</span>{typeof children === "function" ? children(values) : children}</>}</AriaCheckbox>;
}

export function Switch({ children, ...props }: React.ComponentProps<typeof AriaSwitch>) {
  // A switch applies at once, so it is a change: it holds its state while the page is read-only.
  const readOnly = Boolean(useReadOnlyReason());
  return <AriaSwitch {...props} className="wd-switch" isReadOnly={props.isReadOnly || readOnly}>{(values) => <><span aria-hidden="true" className="wd-switch-track"><span /></span>{typeof children === "function" ? children(values) : children}</>}</AriaSwitch>;
}

export function RadioSet({ description, errorMessage, items, label, ...props }: RadioGroupProps & FieldChromeProps & { items: Array<{ id: string; label: ReactNode; description?: ReactNode; isDisabled?: boolean }> }) {
  return <RadioGroup {...props} className="wd-field"><FieldLabel label={label} required={props.isRequired} /><div className="wd-choice-list">{items.map((item) => <Radio className="wd-radio" id={item.id} isDisabled={item.isDisabled} key={item.id} value={item.id}><span aria-hidden="true" className="wd-radio-dot" /><span><strong>{item.label}</strong>{item.description ? <small>{item.description}</small> : null}</span></Radio>)}</div><FieldMeta description={description} errorMessage={errorMessage} /></RadioGroup>;
}

export type SelectItem = { id: string; label: string; description?: string; icon?: ReactNode };
/** Lists longer than this become type-to-filter: one dropdown, with search only where it helps. */
const LONG_LIST = 10;
/** The gap a dropdown list keeps from the viewport edges (px, as React Aria measures). */
const POPOVER_VIEWPORT_PADDING = 12;

export function SelectField({ accent = "brand", description, errorMessage, items, label, prefix, placeholder, size, ...passed }: SelectProps<object> & FieldChromeProps & FieldSizeProps & { accent?: "brand" | "neutral"; prefix?: ReactNode; items: SelectItem[] }) {
  // A value the page controls stays controlled when it has none: `undefined` would hand the field back its own last
  // pick, so the dropdown would show the previous choice instead of the page's (empty) value.
  const props = "selectedKey" in passed && passed.selectedKey === undefined ? { ...passed, selectedKey: null } : passed;
  if (items.length > LONG_LIST) {
    const { selectedKey, defaultSelectedKey, onSelectionChange, isRequired, isDisabled, isInvalid, autoFocus, name, validate, onOpenChange, ...rest } = props;
    return <ComboboxField aria-label={rest["aria-label"]} autoFocus={autoFocus} defaultSelectedKey={defaultSelectedKey} description={description} errorMessage={errorMessage}
      isDisabled={isDisabled} isInvalid={isInvalid} isRequired={isRequired} items={items} label={label} name={name}
      onOpenChange={onOpenChange ? (isOpen) => onOpenChange(isOpen) : undefined} onSelectionChange={onSelectionChange} placeholder={placeholder}
      prefix={prefix} size={size} {...("selectedKey" in props ? { selectedKey } : {})} validate={validate as never} />;
  }
  return <SelectList accent={accent} description={description} errorMessage={errorMessage} items={items} label={label} prefix={prefix} placeholder={placeholder} size={size} {...props} />;
}

function SelectList({ accent = "brand", description, errorMessage, items, label, prefix, placeholder: placeholderProp, size, ...props }: SelectProps<object> & FieldChromeProps & FieldSizeProps & { accent?: "brand" | "neutral"; prefix?: ReactNode; items: SelectItem[] }) {
  const t = useT();
  const placeholder = placeholderProp ?? t("Select an option");
  const { portalContainer, direction } = useDesignSystem();
  const portalTheme = usePortalThemeAttributes();
  // The list opens against a trigger the person can see: the trigger is scrolled into view first, the list flips
  // above when there is no room below, and it closes if a scroll moves the trigger away from it.
  const trigger = useRef<HTMLButtonElement>(null);
  const [ownOpen, setOwnOpen] = useState(props.defaultOpen ?? false);
  const isOpen = props.isOpen ?? ownOpen;
  const openChange = (next: boolean) => {
    if (next) revealAnchor(trigger.current);
    if (props.isOpen === undefined) setOwnOpen(next);
    props.onOpenChange?.(next);
  };
  useCloseOnAnchorScroll(trigger, isOpen, () => openChange(false));
  return <Select {...props} isOpen={isOpen} onOpenChange={openChange} className="wd-field" data-accent={accent} data-size={size} placeholder={placeholder}><FieldLabel label={label} required={props.isRequired} /><AriaButton className="wd-select-button wd-focus-frame" ref={trigger}>{prefix ? <span className="wd-select-prefix" aria-hidden="true">{prefix}</span> : null}<SelectValue className="wd-select-value">{({ isPlaceholder, selectedText }) => isPlaceholder ? placeholder : selectedText}</SelectValue><span aria-hidden="true" className="wd-select-indicator"><ChevronDown size={15} /></span></AriaButton><FieldMeta description={description} errorMessage={errorMessage} /><Popover {...portalTheme} UNSTABLE_portalContainer={portalContainer ?? undefined} className="wd-popover wd-picker-popover" containerPadding={POPOVER_VIEWPORT_PADDING} data-accent={accent} dir={direction} shouldFlip><ListBox items={items}>{(item) => <ListBoxItem className="wd-picker-item" id={item.id} textValue={item.label}><span>{item.label}</span>{item.description ? <small>{item.description}</small> : null}<Check aria-hidden="true" className="wd-picker-check" size={14} /></ListBoxItem>}</ListBox></Popover></Select>;
}

const CREATE_OPTION = "__wd_create__";

export type ComboboxFieldProps = ComboBoxProps<object> & FieldChromeProps & FieldSizeProps & {
  items: SelectItem[]; placeholder?: string; prefix?: ReactNode;
  /** Where the module allows it: typed text that matches no option offers "Create '…'", which calls this. */
  onCreate?: (text: string) => void;
};

export function ComboboxField({ description, errorMessage, items, label, onCreate, placeholder, prefix, size, ...passed }: ComboboxFieldProps) {
  const { portalContainer, direction } = useDesignSystem();
  const portalTheme = usePortalThemeAttributes();
  const t = useT();
  // A controlled value with none is null, never undefined (undefined would bring back the field's own last pick).
  const props = "selectedKey" in passed && passed.selectedKey === undefined ? { ...passed, selectedKey: null } : passed;
  const [typed, setTyped] = useState(props.defaultInputValue ?? "");
  const text = (props.inputValue ?? typed).replace(/\s+/g, " ").trim();
  const known = items.some((item) => item.label.toLocaleLowerCase() === text.toLocaleLowerCase());
  const options: Array<SelectItem & { create?: true }> = onCreate && text && !known ? [...items, { id: CREATE_OPTION, label: text, create: true }] : items;
  // What was typed is what was chosen: on Enter, Tab or leaving the field, text naming exactly one option (its whole
  // label, or the only one it matches) selects it, instead of the list putting the previous choice back.
  const [ownKey, setOwnKey] = useState<Key | null>(props.defaultSelectedKey ?? null);
  const controlled = "selectedKey" in props;
  const current = controlled ? props.selectedKey ?? null : ownKey;
  // Focus selects the chosen label so typing replaces it; text the person is typing is never selected again.
  const selectedLabel = items.find((item) => item.id === current)?.label ?? "";
  const picked = useRef(false);
  const select = (key: Key | null) => {
    picked.current = true; if (!controlled) setOwnKey(key); props.onSelectionChange?.(key);
    // The page holds the text but not the choice (a free-text field with suggestions): a picked suggestion becomes the
    // text, as the field does on its own. React Aria leaves that to the page once the choice is held here too.
    if (!controlled && props.inputValue !== undefined && key !== null) {
      const label = items.find((item) => item.id === key)?.label;
      if (label !== undefined) { setTyped(label); props.onInputChange?.(label); }
    }
  };
  const takeTyped = () => {
    if (picked.current) { picked.current = false; return; }
    if (!text || props.isReadOnly || props.isDisabled || props.allowsCustomValue) return;
    const lower = text.toLocaleLowerCase();
    const exact = items.filter((item) => item.label.toLocaleLowerCase() === lower);
    const containing = items.filter((item) => item.label.toLocaleLowerCase().includes(lower));
    const match = exact.length === 1 ? exact[0] : !exact.length && containing.length === 1 ? containing[0] : null;
    if (match && match.id !== current) select(match.id);
  };
  // Opens on click with the whole list; typing filters. Focus selects the current text so typing replaces it.
  // "No matches" shows only when a real list is filtered to nothing; an empty source (still loading) stays closed.
  return <ComboBox allowsEmptyCollection={items.length > 0} menuTrigger="focus" {...props} selectedKey={current} className="wd-field wd-combobox" data-size={size}
    onInputChange={(value) => { picked.current = false; setTyped(value); props.onInputChange?.(value); }}
    onSelectionChange={(key) => { if (key === CREATE_OPTION) { picked.current = true; if (text) onCreate?.(text); return; } select(key); }}>
    <FieldLabel label={label} required={props.isRequired} /><Group className="wd-input-group wd-focus-frame">{prefix ? <span className="wd-input-affix" data-side="start" aria-hidden="true">{prefix}</span> : null}<Input className="wd-input" onBlur={takeTyped} onFocus={(event) => { if (event.currentTarget.value === selectedLabel) event.currentTarget.select(); }}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === "Tab") takeTyped(); }} placeholder={placeholder ?? t("Type to search")} /><AriaButton aria-label={t("Show options")} className="wd-input-icon-button"><ChevronDown size={15} /></AriaButton></Group><FieldMeta description={description} errorMessage={errorMessage} /><Popover {...portalTheme} UNSTABLE_portalContainer={portalContainer ?? undefined} className="wd-popover wd-picker-popover" dir={direction}><ListBox items={options} renderEmptyState={() => <p className="wd-picker-empty">{t("No matches")}</p>}>{(item) => item.create
      ? <ListBoxItem className="wd-picker-item wd-picker-create" id={item.id} textValue={item.label}><Plus aria-hidden="true" size={14} /><span>{t("Create “{name}”", { name: item.label })}</span></ListBoxItem>
      : <ListBoxItem className="wd-picker-item" id={item.id} textValue={item.label}>{item.icon ? <span className="wd-option-icon" aria-hidden="true">{item.icon}</span> : null}<span>{item.label}</span>{item.description ? <small>{item.description}</small> : null}<Check aria-hidden="true" className="wd-picker-check" size={14} /></ListBoxItem>}</ListBox></Popover></ComboBox>;
}

export function MultiSelectField({ isDisabled, isRequired, label, items, selectedKeys, onSelectionChange, onCreate }: { isDisabled?: boolean; isRequired?: boolean; label: string; items: SelectItem[]; selectedKeys: Set<Key>; onSelectionChange: (keys: Set<Key>) => void;
  /** Where the module allows it: a typed name that matches no option offers "Create '…'" (free text, saved by the caller). */
  onCreate?: (text: string) => void }) {
  const t = useT();
  const available = items.filter((item) => !selectedKeys.has(item.id));
  return <div aria-label={label} className="wd-field" role="group"><FieldCaption isRequired={isRequired}>{label}</FieldCaption><div className="wd-multi-select">{items.filter((item) => selectedKeys.has(item.id)).map((item) => <Tag key={item.id} onRemove={isDisabled ? undefined : () => { const next = new Set(selectedKeys); next.delete(item.id); onSelectionChange(next); }}>{item.label}</Tag>)}{isDisabled ? null : <FormFieldContext.Provider value={null}><ComboboxField aria-label={t("Add {name}", { name: label })} items={available} label={<span className="wd-visually-hidden">{t("Add {name}", { name: label })}</span>} onCreate={onCreate} onSelectionChange={(key) => { if (key) onSelectionChange(new Set([...selectedKeys, key])); }} placeholder={t("Add…")} /></FormFieldContext.Provider>}</div></div>;
}

function CalendarHeader() { const t = useT(); return <header className="wd-calendar-header"><AriaButton aria-label={t("Previous month")} slot="previous"><ChevronLeft data-directional="true" size={15} /></AriaButton><Heading /><AriaButton aria-label={t("Next month")} slot="next"><ChevronRight data-directional="true" size={15} /></AriaButton></header>; }
type CalendarStart={firstDayOfWeek?:CalendarProps<DateValue>['firstDayOfWeek']};
function CalendarBody({firstDayOfWeek}:CalendarStart) { return <Calendar firstDayOfWeek={firstDayOfWeek} className="wd-calendar"><CalendarHeader /><CalendarGrid>{(date) => <CalendarCell className="wd-calendar-cell" date={date} />}</CalendarGrid></Calendar>; }
function RangeCalendarBody() { return <RangeCalendar className="wd-calendar"><CalendarHeader /><CalendarGrid>{(date) => <CalendarCell className="wd-calendar-cell" date={date} />}</CalendarGrid></RangeCalendar>; }

export type DateFieldProps = DatePickerProps<DateValue> & FieldChromeProps & FieldSizeProps & CalendarStart & {
  /**
   * One-tap dates (Today, Tomorrow, the next working day). "popover" (default) puts them above the calendar;
   * "inline" also shows them under the field, for forms where a date is usually soon (a follow-up); false hides them.
   */
  quickPicks?: boolean | "popover" | "inline";
};

export function DateField({ description, errorMessage, label, firstDayOfWeek, quickPicks = "popover", size, ...props }: DateFieldProps) {
  const t = useT();
  const { portalContainer, direction } = useDesignSystem();
  const portalTheme = usePortalThemeAttributes();
  const limits = { minValue: props.minValue, maxValue: props.maxValue, isDateUnavailable: props.isDateUnavailable };
  const picks = quickPicks && !props.isReadOnly ? <DateQuickPicks isDisabled={props.isDisabled} limits={limits} /> : null;
  return <DatePicker {...props} className="wd-field" data-size={size}><FieldLabel label={label} required={props.isRequired} /><Group className="wd-date-group wd-focus-frame"><DateInput className="wd-date-input">{(segment) => <DateSegment className="wd-date-segment" segment={segment} />}</DateInput><AriaButton aria-label={t("Open calendar")}><CalendarDays size={15} /></AriaButton></Group>{quickPicks === "inline" ? picks : null}<FieldMeta description={description} errorMessage={errorMessage} /><Popover {...portalTheme} UNSTABLE_portalContainer={portalContainer ?? undefined} className="wd-popover wd-calendar-popover" dir={direction}><DialogCalendar firstDayOfWeek={firstDayOfWeek} picks={picks} /></Popover></DatePicker>;
}

/** The clock a locale writes times with: 12 (with AM/PM) or 24 hours. */
export function localeHourCycle(locale: string): 12 | 24 {
  try { const cycle = new Intl.DateTimeFormat(locale, { hour: "numeric" }).resolvedOptions().hourCycle; return cycle === "h23" || cycle === "h24" ? 24 : 12; } catch { return 12; }
}

/** A time of day, on the workspace locale's clock (12-hour with AM/PM, or 24-hour) unless the field says otherwise. */
export function TimeField({ description, errorMessage, label, hourCycle, size, ...props }: TimeFieldProps<TimeValue> & FieldChromeProps & FieldSizeProps) {
  const { locale } = useDesignSystem();
  return <AriaTimeField {...props} hourCycle={hourCycle ?? localeHourCycle(locale)} className="wd-field" data-size={size}><FieldLabel label={label} required={props.isRequired} /><DateInput className="wd-date-group wd-date-input wd-time-input wd-focus-frame">{segment => <DateSegment className="wd-date-segment" segment={segment} />}</DateInput><FieldMeta description={description} errorMessage={errorMessage} /></AriaTimeField>;
}

function DialogCalendar({ firstDayOfWeek, picks }: CalendarStart & { picks?: ReactNode }) {
  return <div role="dialog">{picks}<CalendarBody firstDayOfWeek={firstDayOfWeek} /></div>;
}

export function DateRangeField({ description, errorMessage, label, size, ...props }: DateRangePickerProps<DateValue> & FieldChromeProps & FieldSizeProps) {
  const t = useT();
  const { portalContainer, direction } = useDesignSystem();
  const portalTheme = usePortalThemeAttributes();
  return <DateRangePicker {...props} className="wd-field" data-size={size}><FieldLabel label={label} required={props.isRequired} /><Group className="wd-date-group wd-focus-frame"><DateInput className="wd-date-input" slot="start">{(segment) => <DateSegment className="wd-date-segment" segment={segment} />}</DateInput><span aria-hidden="true">–</span><DateInput className="wd-date-input" slot="end">{(segment) => <DateSegment className="wd-date-segment" segment={segment} />}</DateInput><AriaButton aria-label={t("Open calendar")}><CalendarDays size={15} /></AriaButton></Group><FieldMeta description={description} errorMessage={errorMessage} /><Popover {...portalTheme} UNSTABLE_portalContainer={portalContainer ?? undefined} className="wd-popover wd-calendar-popover" dir={direction}><div role="dialog"><RangeCalendarBody /></div></Popover></DateRangePicker>;
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
  const optional = useOptionalMarker(false);
  const has = (value: string) => values.some((item) => item.toLocaleLowerCase() === value.toLocaleLowerCase());
  const add = (value: string) => {
    const text = value.replace(/\s+/g, " ").trim();
    setDraft("");
    if (!text || has(text)) return;
    onChange([...values, suggestions.find((item) => item.toLocaleLowerCase() === text.toLocaleLowerCase()) ?? text]);
  };
  const options = suggestions.filter((item) => !has(item)).slice(0, 50);
  return <div className="wd-field wd-tags-field">
    <span className="wd-field-label" aria-hidden="true" data-optional={optional}>{label}</span>
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
export function FileUploader({ accept, appearance = "dropzone", label: labelProp, multiple = true, onFiles }: { accept?: string; appearance?: "dropzone" | "button"; label?: string; multiple?: boolean; onFiles?: (files: File[]) => void }) {
  const t = useT();
  const label = labelProp ?? t("Upload files");
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<UploadFile[]>([]);
  // An upload is a change: off while the page is read-only.
  const readOnlyReason = useReadOnlyReason();
  const addFiles = (nextFiles: File[]) => { if (readOnlyReason) return; setFiles((current) => [...current, ...nextFiles.map((file) => ({ id: `${file.name}-${file.lastModified}`, file, progress: 100, status: "complete" as const }))]); onFiles?.(nextFiles); };
  const change = (event: ChangeEvent<HTMLInputElement>) => addFiles(Array.from(event.target.files ?? []));
  return <div className="wd-uploader" data-appearance={appearance}>{appearance === "button"
    ? <Button intent="write" onPress={() => input.current?.click()} size="compact" variant="quiet"><Upload aria-hidden="true" size={14} />{label}</Button>
    : <button className="wd-drop-zone" disabled={Boolean(readOnlyReason)} onClick={() => input.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); addFiles(Array.from(event.dataTransfer.files)); }} title={readOnlyReason ?? undefined} type="button"><Upload aria-hidden="true" size={18} /><strong>{label}</strong><span>{t("Drop files here or choose from your device")}</span></button>}
    <input accept={accept} aria-label={label} className="wd-visually-hidden" disabled={Boolean(readOnlyReason)} multiple={multiple} onChange={change} ref={input} type="file" />
    {appearance === "dropzone" ? <div className="wd-upload-list">{files.map((item) => <div key={item.id}><Paperclip size={14} /><span>{item.file.name}</span><small>{Math.ceil(item.file.size / 1024)} KB</small><IconButton aria-label={t("Remove {name}", { name: item.file.name })} onPress={() => setFiles((current) => current.filter((file) => file.id !== item.id))}><X size={13} /></IconButton></div>)}</div> : null}</div>;
}

export function LogoUploader(props: Omit<React.ComponentProps<typeof FileUploader>, "accept" | "multiple">) { const t = useT(); return <FileUploader {...props} accept="image/png,image/jpeg,image/webp,image/svg+xml" label={props.label ?? t("Upload organization logo")} multiple={false} />; }

export function AutosaveState({ state }: { state: "idle" | "saving" | "saved" | "error" }) { const t = useT(); return <span aria-live="polite" className="wd-autosave" data-state={state}>{state === "saving" ? t("Saving…") : state === "saved" ? t("Saved") : state === "error" ? t("Could not save") : ""}</span>; }

export function SegmentedControl({ label, onChange, options, value, tour, isDisabled = false }: { label: string; onChange: (value: string) => void; /** An option's description shows on hover; a disabled option can't be chosen. */ options: Array<SelectItem & { count?: number; isDisabled?: boolean }>; value: string; /** Names each option `data-tour="<tour>-<id>"` for Woddy's tours. */ tour?: string; /** The whole control reads but can't change (a locked record). */ isDisabled?: boolean }) { return <div aria-disabled={isDisabled || undefined} aria-label={label} className="wd-segmented" role="radiogroup">{options.map((option) => <button aria-checked={value === option.id} data-tour={tour ? `${tour}-${option.id}` : undefined} data-tour-safe={tour ? "" : undefined} disabled={isDisabled || option.isDisabled} key={option.id} onClick={() => onChange(option.id)} role="radio" title={option.description} type="button">{option.label}{typeof option.count === "number" ? <span className="wd-count-chip">{option.count}</span> : null}</button>)}</div>; }

export function RepeatableFields<T>({ addLabel, items, onAdd, onRemove, renderItem }: { addLabel?: string; items: T[]; onAdd: () => void; onRemove: (index: number) => void; renderItem: (item: T, index: number) => ReactNode }) { const t = useT(); return <div className="wd-repeatable"><div>{items.map((item, index) => <div className="wd-repeatable-row" key={index}><div>{renderItem(item, index)}</div><IconButton aria-label={t("Remove item {number}", { number: index + 1 })} onPress={() => onRemove(index)}><X size={14} /></IconButton></div>)}</div><Button onPress={onAdd}>{addLabel ?? t("Add item")}</Button></div>; }

export type FormProps = FormHTMLAttributes<HTMLFormElement> & {
  /** "optional" (default) marks the fields a person may skip; "none" leaves every label bare. */
  fieldMarkers?: FormFieldMarkers;
  /** A blocked save names the fields to fix at the top of the form and takes focus to the first (default on). */
  errorSummary?: boolean;
  ref?: Ref<HTMLFormElement>;
};

/**
 * The shared form: one column of fields, "Optional" on the ones a person may skip and, when a save is blocked,
 * a summary at the top naming the fields to fix (focus goes to the first). A read-only page never submits:
 * Enter in a field does nothing, like the disabled Save beside it.
 */
export function Form({ children, className, errorSummary = true, fieldMarkers = "optional", onSubmit, ref, ...props }: FormProps) {
  const readOnlyReason = useReadOnlyReason();
  const summary = useErrorSummary();
  const markers = useMemo(() => ({ markers: fieldMarkers }), [fieldMarkers]);
  return <FormFieldContext.Provider value={markers}>
    <form {...props} className={["wd-form", className].filter(Boolean).join(" ")} data-read-only={readOnlyReason ? "" : undefined}
      data-wd-error-summary={errorSummary ? "" : undefined} ref={ref}
      onBlurCapture={errorSummary ? summary.recheck : undefined} onChangeCapture={errorSummary ? summary.recheck : undefined}
      onInvalidCapture={errorSummary ? summary.onInvalidCapture : undefined}
      // A form in a dialog sits inside its page's React tree: its submit stops here, not at a form around it.
      onSubmit={readOnlyReason ? (event) => { event.preventDefault(); event.stopPropagation(); } : (event) => { event.stopPropagation(); summary.clear(); onSubmit?.(event); }}>
      {errorSummary ? summary.node : null}{children}
    </form>
  </FormFieldContext.Provider>;
}
export function Fieldset({ children, description, legend }: { children: ReactNode; description?: ReactNode; legend: ReactNode }) { return <fieldset className="wd-fieldset"><legend>{legend}</legend>{description ? <p>{description}</p> : null}{children}</fieldset>; }
export function ValidationSummary({ errors }: { errors: string[] }) { const t = useT(); if (!errors.length) return null; return <div className="wd-validation-summary" role="alert"><strong>{t("Check the highlighted fields")}</strong><ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul></div>; }
