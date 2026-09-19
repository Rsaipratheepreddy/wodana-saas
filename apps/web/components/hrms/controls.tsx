"use client";
import {
  Children,
  isValidElement,
  type ReactNode,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import {
  Button as SystemButton,
  Checkbox as SystemCheckbox,
  SelectField as SystemSelect,
} from "@/design-system";
import type { DataColumn } from "@/components/ui/data-table";

export function Button({
  children,
  variant = "primary",
  size = "md",
  loading,
  disabled,
  onClick,
  ...props
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit" | "reset";
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <SystemButton
      {...props}
      type={props.type ?? "button"}
      variant={variant === "ghost" ? "quiet" : variant}
      size={size === "sm" ? "compact" : size === "lg" ? "large" : "standard"}
      isLoading={loading}
      isDisabled={disabled}
      onPress={onClick}
    >
      {children}
    </SystemButton>
  );
}

type FieldMeta = {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
};
function Field({
  id,
  label,
  hint,
  error,
  optional,
  children,
}: FieldMeta & { children: ReactNode }) {
  return (
    <div className="wd-field">
      <label className="wd-field-label" htmlFor={id}>
        {label}
        {optional ? <small className="hrms-optional">Optional</small> : null}
      </label>
      {children}
      {hint || error ? (
        <span
          id={`${id}-description`}
          className={error ? "wd-field-error" : "wd-field-help"}
        >
          {error || hint}
        </span>
      ) : null}
    </div>
  );
}
export function TextField({
  id,
  label,
  hint,
  error,
  optional,
  ...props
}: FieldMeta & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Field {...{ id, label, hint, error, optional }}>
      <span className="wd-input-group wd-focus-frame">
        <input
          {...props}
          id={id}
          className="wd-input"
          aria-invalid={!!error}
          aria-describedby={hint || error ? `${id}-description` : undefined}
        />
      </span>
    </Field>
  );
}
export function TextArea({
  id,
  label,
  hint,
  error,
  optional,
  ...props
}: FieldMeta & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Field {...{ id, label, hint, error, optional }}>
      <span className="wd-textarea-frame wd-focus-frame">
        <textarea
          {...props}
          id={id}
          className="wd-textarea"
          aria-invalid={!!error}
          aria-describedby={hint || error ? `${id}-description` : undefined}
        />
      </span>
    </Field>
  );
}
function optionText(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) =>
      isValidElement<{ children?: ReactNode }>(child)
        ? optionText(child.props.children)
        : String(child),
    )
    .join("");
}
export function SelectField({
  children,
  value,
  onChange,
  id,
  label,
  hint,
  error,
  required,
  disabled,
}: FieldMeta & {
  children: ReactNode;
  value: string | number;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
}) {
  function collectOptions(
    nodes: ReactNode,
  ): Array<{ id: string; label: string; disabled?: boolean }> {
    return Children.toArray(nodes).flatMap((child) => {
      if (
        !isValidElement<{
          value?: string | number;
          children?: ReactNode;
          disabled?: boolean;
        }>(child)
      )
        return [];
      if (child.type !== "option") return collectOptions(child.props.children);
      return [
        {
          id: String(child.props.value ?? ""),
          label: optionText(child.props.children),
          disabled: child.props.disabled,
        },
      ];
    });
  }
  const options = collectOptions(children);
  return (
    <SystemSelect
      id={id}
      label={label}
      items={options.map((o) => ({ ...o, id: o.id || "__hrms_none__" }))}
      placeholder={
        options.find((o) => o.id === "")?.label ?? "Select an option"
      }
      selectedKey={String(value) || null}
      onSelectionChange={(key) =>
        onChange(key === null || key === "__hrms_none__" ? "" : String(key))
      }
      description={hint}
      errorMessage={error}
      isInvalid={!!error}
      isRequired={required}
      isDisabled={disabled}
      disabledKeys={options.filter((o) => o.disabled).map((o) => o.id)}
    />
  );
}
export function Checkbox({
  children,
  checked,
  onChange,
  disabled,
}: {
  children: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <SystemCheckbox
      isSelected={checked}
      onChange={onChange}
      isDisabled={disabled}
    >
      {children}
    </SystemCheckbox>
  );
}
export function DataTable<Row>({
  caption,
  columns,
  getRowKey,
  rows,
}: {
  caption: string;
  columns: DataColumn<Row>[];
  getRowKey: (row: Row) => string;
  rows: Row[];
}) {
  return (
    <div className="wd-table-frame">
      <div
        className="wd-table-scroll"
        role="region"
        aria-label={caption}
        tabIndex={0}
      >
        <table data-record-table="" className="wd-table">
          <caption className="wd-visually-hidden">{caption}</caption>
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  style={{ textAlign: c.align ?? "start" }}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={getRowKey(row)}>
                {columns.map((c) => (
                  <td key={c.key} style={{ textAlign: c.align ?? "start" }}>
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <footer className="wd-table-footer">
        {rows.length} {rows.length === 1 ? "record" : "records"}
      </footer>
    </div>
  );
}
