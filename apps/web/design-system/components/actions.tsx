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

type ButtonVariant = "primary" | "secondary" | "quiet" | "danger" | "gradient";
type ButtonSize = "compact" | "standard" | "large";

export type ButtonProps = AriaButtonProps & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  /** Only for deliberate selection actions; success feedback belongs after the action succeeds. */
  haptic?: "selection";
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { children, className, haptic, isDisabled, isLoading = false, onPress, size = "standard", variant = "secondary", ...props },
  ref,
) {
  return (
    <AriaButton
      {...props}
      className={(state) => ["wd-button", typeof className === "function" ? className(state) : className].filter(Boolean).join(" ")}
      data-size={size}
      data-variant={variant}
      isDisabled={isDisabled || isLoading}
      onPress={(event) => { if (haptic) emitHapticFeedback(haptic); onPress?.(event); }}
      ref={ref}
    >
      {(values) => <>{isLoading ? <LoaderCircle aria-hidden="true" className="wd-spin" size={16} /> : null}{typeof children === "function" ? children(values) : children}</>}
    </AriaButton>
  );
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
  return (
    <MenuItem
      className="wd-menu-item"
      id={item.id}
      isDisabled={item.isDisabled}
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
}: {
  ariaLabel: string;
  icon?: ReactNode;
  items: ActionItem[];
  onAction?: (id: string) => void;
}) {
  const { direction } = useDesignSystem();
  const portalTheme = usePortalThemeAttributes();
  return (
    <MenuTrigger>
      <IconButton aria-label={ariaLabel} size="compact">{icon}</IconButton>
      <Popover {...portalTheme} className="wd-popover" dir={direction} placement="bottom end">
        <Menu aria-label={ariaLabel} className="wd-menu" items={items}>
          {(item) => <ActionMenuItem item={item} onAction={onAction} />}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}

export function SplitButton({ items, label, onAction, onPress }: { items: ActionItem[]; label: ReactNode; onAction?: (id: string) => void; onPress?: () => void }) {
  const t = useT();
  const { direction } = useDesignSystem();
  const portalTheme = usePortalThemeAttributes();
  return (
    <ButtonGroup attached>
      <Button onPress={onPress} variant="primary">{label}</Button>
      <MenuTrigger>
        <IconButton aria-label={t("{name} options", { name: String(label) })} variant="primary"><ChevronDown aria-hidden="true" size={15} /></IconButton>
        <Popover {...portalTheme} className="wd-popover" dir={direction} placement="bottom end"><Menu className="wd-menu" items={items}>{(item) => <ActionMenuItem item={item} onAction={onAction} />}</Menu></Popover>
      </MenuTrigger>
    </ButtonGroup>
  );
}

export type { MenuItemProps };
