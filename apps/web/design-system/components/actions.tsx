"use client";

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

type ButtonVariant = "primary" | "secondary" | "quiet" | "danger" | "gradient";
type ButtonSize = "compact" | "standard" | "large";

export type ButtonProps = AriaButtonProps & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { children, className, isDisabled, isLoading = false, size = "standard", variant = "secondary", ...props },
  ref,
) {
  return (
    <AriaButton
      {...props}
      className={(state) => ["wd-button", typeof className === "function" ? className(state) : className].filter(Boolean).join(" ")}
      data-size={size}
      data-variant={variant}
      isDisabled={isDisabled || isLoading}
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

export function MenuButton({ items, label = "Actions", onAction }: { items: ActionItem[]; label?: ReactNode; onAction?: (id: string) => void }) {
  return (
    <MenuTrigger>
      <Button>{label}<ChevronDown aria-hidden="true" size={15} /></Button>
      <Popover className="wd-popover" placement="bottom end">
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
  return (
    <MenuTrigger>
      <IconButton aria-label={ariaLabel} size="compact">{icon}</IconButton>
      <Popover className="wd-popover" placement="bottom end">
        <Menu aria-label={ariaLabel} className="wd-menu" items={items}>
          {(item) => <ActionMenuItem item={item} onAction={onAction} />}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}

export function SplitButton({ items, label, onAction, onPress }: { items: ActionItem[]; label: ReactNode; onAction?: (id: string) => void; onPress?: () => void }) {
  return (
    <ButtonGroup attached>
      <Button onPress={onPress} variant="primary">{label}</Button>
      <MenuTrigger>
        <IconButton aria-label={`${String(label)} options`} variant="primary"><ChevronDown aria-hidden="true" size={15} /></IconButton>
        <Popover className="wd-popover" placement="bottom end"><Menu className="wd-menu" items={items}>{(item) => <ActionMenuItem item={item} onAction={onAction} />}</Menu></Popover>
      </MenuTrigger>
    </ButtonGroup>
  );
}

export type { MenuItemProps };
