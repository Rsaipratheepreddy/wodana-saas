import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { Icon, type IconName } from "./icon";
import styles from "./ui.module.css";

type FieldMeta = {
  error?: string;
  hint?: string;
  label: string;
  optional?: boolean;
};

function FieldShell({
  children,
  error,
  hint,
  id,
  label,
  optional,
}: FieldMeta & { children: React.ReactNode; id: string }) {
  const descriptionId = error || hint ? `${id}-description` : undefined;
  return (
    <label className={styles.field} htmlFor={id}>
      <span className={styles.labelRow}>
        <span className={styles.label}>{label}</span>
        {optional ? <span className={styles.optional}>Optional</span> : null}
      </span>
      {children}
      {error ? <span className={styles.errorText} id={descriptionId}>{error}</span> : null}
      {!error && hint ? <span className={styles.hint} id={descriptionId}>{hint}</span> : null}
    </label>
  );
}

export function TextField({
  error,
  hint,
  icon,
  id,
  label,
  optional,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & FieldMeta & { id: string; icon?: IconName }) {
  const describedBy = error || hint ? `${id}-description` : undefined;
  return (
    <FieldShell error={error} hint={hint} id={id} label={label} optional={optional}>
      <span className={styles.inputWrap}>
        {icon ? <Icon className={styles.inputIcon} name={icon} /> : null}
        <input
          aria-describedby={describedBy}
          aria-invalid={Boolean(error)}
          className={`${styles.input} ${icon ? styles.inputWithIcon : ""} ${error ? styles.inputError : ""}`}
          id={id}
          {...props}
        />
      </span>
    </FieldShell>
  );
}

export function TextArea({ error, hint, id, label, optional, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & FieldMeta & { id: string }) {
  const describedBy = error || hint ? `${id}-description` : undefined;
  return (
    <FieldShell error={error} hint={hint} id={id} label={label} optional={optional}>
      <textarea
        aria-describedby={describedBy}
        aria-invalid={Boolean(error)}
        className={`${styles.textarea} ${error ? styles.inputError : ""}`}
        id={id}
        {...props}
      />
    </FieldShell>
  );
}

export function SelectField({ children, error, hint, id, label, optional, ...props }: SelectHTMLAttributes<HTMLSelectElement> & FieldMeta & { id: string }) {
  const describedBy = error || hint ? `${id}-description` : undefined;
  return (
    <FieldShell error={error} hint={hint} id={id} label={label} optional={optional}>
      <span className={styles.inputWrap}>
        <select
          aria-describedby={describedBy}
          aria-invalid={Boolean(error)}
          className={`${styles.select} ${error ? styles.inputError : ""}`}
          id={id}
          {...props}
        >
          {children}
        </select>
        <Icon className={styles.selectChevron} name="chevron-down" />
      </span>
    </FieldShell>
  );
}

export function Checkbox({ children, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={styles.checkRow}>
      <input className={styles.checkbox} type="checkbox" {...props} />
      <span>{children}</span>
    </label>
  );
}

export function Radio({ children, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={styles.checkRow}>
      <input className={styles.radio} type="radio" {...props} />
      <span>{children}</span>
    </label>
  );
}

export function FileField({
  accept,
  hint,
  id,
  label,
}: {
  accept?: string;
  hint?: string;
  id: string;
  label: string;
}) {
  return (
    <FieldShell hint={hint} id={id} label={label}>
      <input accept={accept} className={styles.fileInput} id={id} type="file" />
    </FieldShell>
  );
}
