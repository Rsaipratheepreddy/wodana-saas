"use client";

import { useT } from "@/lib/i18n/i18n-provider";
import { forwardRef, type ReactNode } from "react";
import {
  Button as AriaButton,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
  type ButtonProps as AriaButtonProps,
  type MenuItemProps,
} from "react-aria-components";
import { ChevronDown, Ellipsis, LoaderCircle } from "lucide-react";
import { emitHapticFeedback } from "../foundations/haptics";
import { useDesignSystem, usePortalThemeAttributes } from "../foundations/provider";
import { useReadOnlyReason } from "../foundations/read-only";

type ButtonVariant = "primary" | "secondary" | "quiet" | "danger" | "gradient";
/**
 * The one control scale (tokens.css): compact 28px, standard 32px, large 40px. Buttons are standard by default and
 * fields large; a button and a field of the same size are the same height. Height, padding and gaps come from the
 * size, never from a screen.
 */
export type ControlSize = "compact" | "standard" | "large";
type ButtonSize = ControlSize;

export type ButtonProps = AriaButtonProps & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  /** Only for deliberate selection actions; success feedback belongs after the action succeeds. */
  haptic?: "selection";
  /**
   * Whether pressing it changes something. Primary, danger and submit buttons write unless marked "read"; any
   * other button writes only when marked "write". A writing button shows disabled, with the reason as its
   * tooltip, while the page is read-only (for example while viewing as someone).
   */
  intent?: "read" | "write";
};

/** True when a button changes something, so it is turned off while the page is read-only. */
export function buttonWrites({ intent, type, variant = "secondary" }: Pick<ButtonProps, "intent" | "type" | "variant">) {
  if (intent) return intent === "write";
  return type === "submit" || variant === "primary" || variant === "danger" || variant === "gradient";
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { children, className, haptic, intent, isDisabled, isLoading = false, onPress, size = "standard", variant = "secondary", ...props },
  ref,
) {
  const readOnlyReason = useReadOnlyReason();
  const locked = Boolean(readOnlyReason) && buttonWrites({ intent, type: props.type, variant });
  const button = (
    <AriaButton
      {...props}
      className={(state) => ["wd-button", typeof className === "function" ? className(state) : className].filter(Boolean).join(" ")}
      data-read-only={locked || undefined}
      data-size={size}
      data-variant={variant}
      isDisabled={isDisabled || isLoading || locked}
      onPress={(event) => { if (haptic) emitHapticFeedback(haptic); onPress?.(event); }}
      ref={ref}
    >
      {(values) => <>{isLoading ? <LoaderCircle aria-hidden="true" className="wd-spin" size={16} /> : null}{typeof children === "function" ? children(values) : children}</>}
    </AriaButton>
  );
  // The wrapper adds no box of its own; it carries the reason as the disabled button's tooltip.
  return locked ? <span className="wd-read-only-action" title={readOnlyReason ?? undefined}>{button}</span> : button;
});

export const IconButton = forwardRef<HTMLButtonElement, Omit<ButtonProps, "size"> & { size?: ButtonSize }>(function IconButton(
  { className, variant = "quiet", ...props },
  ref,
) {
  return <Button {...props} className={(state) => ["wd-icon-button", typeof className === "function" ? className(state) : className].filter(Boolean).join(" ")} ref={ref} variant={variant} />;
});

export function ButtonGroup({ children, attached = false }: { children: ReactNode; attached?: boolean }) {
  return <div className="wd-button-group" data-attached={attached} role="group">{children}</div>;
}

export function ToggleButton({ isSelected, ...props }: ButtonProps & { isSelected?: boolean }) {
  return <Button {...props} aria-pressed={isSelected} data-selected={isSelected || undefined} />;
}

export type ActionItem = { id: string; label: string; isDisabled?: boolean; tone?: "default" | "danger" };

function ActionMenuItem({ item, onAction }: { item: ActionItem; onAction?: (id: string) => void }) {
  // A destructive action is off while the page is read-only; the others open a view or a dialog whose save is.
  const readOnly = Boolean(useReadOnlyReason()) && item.tone === "danger";
  return (
    <MenuItem
      className="wd-menu-item"
      id={item.id}
      isDisabled={item.isDisabled || readOnly}
      onAction={() => onAction?.(item.id)}
      textValue={item.label}
    >
      <span data-tone={item.tone}>{item.label}</span>
    </MenuItem>
  );
}

export function MenuButton({ items, label, onAction, size = "standard" }: { items: ActionItem[]; label?: ReactNode; onAction?: (id: string) => void; size?: ButtonSize }) {
  const t = useT();
  const { direction } = useDesignSystem();
  const portalTheme = usePortalThemeAttributes();
  return (
    <MenuTrigger>
      <Button size={size}>{label ?? t("Actions")}<ChevronDown aria-hidden="true" size={15} /></Button>
      <Popover {...portalTheme} className="wd-popover" dir={direction} placement="bottom end">
        <Menu className="wd-menu" items={items}>{(item) => <ActionMenuItem item={item} onAction={onAction} />}</Menu>
      </Popover>
    </MenuTrigger>
  );
}

export function IconMenuButton({
  ariaLabel,
  icon = <Ellipsis aria-hidden="true" size={16} />,
  items,
  onAction,
  size = "compact",
  variant = "quiet",
  count = 0,
}: {
  ariaLabel: string;
  icon?: ReactNode;
  items: ActionItem[];
  onAction?: (id: string) => void;
  /** A row's "⋯" is compact and quiet; beside a page's primary action it takes that action's size, as a secondary. */
  size?: ButtonSize;
  variant?: ButtonVariant;
  /** A filter menu: how many filters are in use, shown beside the icon as the toolbar's Filter button shows it. */
  count?: number;
}) {
  const { direction } = useDesignSystem();
  const portalTheme = usePortalThemeAttributes();
  return (
    <MenuTrigger>
      {count > 0
        ? <Button aria-label={`${ariaLabel} (${count})`} className="wd-filter-button" data-active size={size} variant={variant}>{icon}<span aria-hidden="true" className="wd-count-chip">{count}</span></Button>
        : <IconButton aria-label={ariaLabel} size={size} variant={variant}>{icon}</IconButton>}
      <Popover {...portalTheme} className="wd-popover" dir={direction} placement="bottom end">
        <Menu aria-label={ariaLabel} className="wd-menu" items={items}>
          {(item) => <ActionMenuItem item={item} onAction={onAction} />}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}

export function SplitButton({ items, label, onAction, onPress, size = "standard", isDisabled = false }: { items: ActionItem[]; label: ReactNode; onAction?: (id: string) => void; onPress?: () => void; size?: ButtonSize; isDisabled?: boolean }) {
  const t = useT();
  const { direction } = useDesignSystem();
  const portalTheme = usePortalThemeAttributes();
  return (
    <ButtonGroup attached>
      <Button isDisabled={isDisabled} onPress={onPress} size={size} variant="primary">{label}</Button>
      <MenuTrigger>
        <IconButton aria-label={t("{name} options", { name: String(label) })} isDisabled={isDisabled} size={size} variant="primary"><ChevronDown aria-hidden="true" size={15} /></IconButton>
        <Popover {...portalTheme} className="wd-popover" dir={direction} placement="bottom end"><Menu className="wd-menu" items={items}>{(item) => <ActionMenuItem item={item} onAction={onAction} />}</Menu></Popover>
      </MenuTrigger>
    </ButtonGroup>
  );
}

export type { MenuItemProps };
