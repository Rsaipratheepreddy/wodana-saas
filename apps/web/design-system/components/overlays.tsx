"use client";

import { useT } from "@/lib/i18n/i18n-provider";
import { createContext, useCallback, useContext, useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import {
  Dialog,
  DialogTrigger,
  Heading,
  Modal,
  ModalOverlay,
  Popover,
  Tooltip,
  TooltipTrigger,
  type DialogTriggerProps,
} from "react-aria-components";
import { X } from "lucide-react";
import { useDesignSystem, usePortalThemeAttributes } from "../foundations/provider";
import { Button, IconButton } from "./actions";
import { submitOnModEnter } from "./form-context";

export function TooltipBubble({ children, content }: { children: ReactNode; content: ReactNode }) {
  const { direction } = useDesignSystem();
  const portalTheme = usePortalThemeAttributes();
  return <TooltipTrigger delay={450}><span>{children}</span><Tooltip {...portalTheme} className="wd-tooltip" dir={direction} offset={6}>{content}</Tooltip></TooltipTrigger>;
}

export function PopoverSurface({ children }: { children: ReactNode }) {
  const { direction } = useDesignSystem();
  const portalTheme = usePortalThemeAttributes();
  return <Popover {...portalTheme} className="wd-popover" dir={direction}>{children}</Popover>;
}

// A modal hides the rest of the page from where it first opened. A page's own portal only exists after its first
// render, so a dialog open on arrival (a record link) opens in the document and then moves into the page; keyed by
// its portal it opens again there, otherwise the page around it stays hidden and inert with the dialog inside it.
const portalIds = new WeakMap<Element, number>();
let nextPortalId = 0;
function portalKey(container: Element | null) {
  if (!container) return "document";
  let id = portalIds.get(container);
  if (id === undefined) { id = ++nextPortalId; portalIds.set(container, id); }
  return `portal-${id}`;
}

/**
 * Where a custom modal (one built on React Aria's ModalOverlay directly) opens: the page's portal, beside the lists,
 * menus and confirmations it opens, never the document. A modal in the document hides the page's portal, so a dropdown
 * opened from inside it would land in that hidden part and could not be clicked. Use `key` on the ModalOverlay.
 */
export function useModalPortal() {
  const { portalContainer } = useDesignSystem();
  return { key: portalKey(portalContainer), container: portalContainer ?? undefined };
}

type ModalDialogProps = Omit<DialogTriggerProps, "children"> & {
  children: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  title: string;
  trigger: ReactNode;
};

type ControlledModalDialogProps = {
  children: ReactNode;
  className?: string;
  description?: ReactNode;
  footer?: ReactNode;
  hideTitle?: boolean;
  isDismissable?: boolean;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  size?: "md" | "lg" | "xl";
  title: string;
  /** Unsaved changes: Esc, the close button, a click outside and `useDialogClose()` ask before closing. */
  isDirty?: boolean;
  /** The changes are kept as a draft, so closing only confirms that (nothing is lost). */
  keepsDraft?: boolean;
  /** Keys pressed anywhere in the dialog (a shortcut that submits its form). */
  onKeyDown?: (event: globalThis.KeyboardEvent) => void;
};

/** Closes the enclosing dialog the way its close button does (asking first when it has unsaved changes). */
const DialogCloseContext = createContext<() => void>(() => undefined);
export function useDialogClose() { return useContext(DialogCloseContext); }

export function ModalDialog({ children, description, footer, title, trigger, ...props }: ModalDialogProps) {
  const t = useT();
  const { portalContainer, direction } = useDesignSystem();
  const portalTheme = usePortalThemeAttributes();
  return <DialogTrigger {...props}><>{trigger}</><ModalOverlay key={portalKey(portalContainer)} {...portalTheme} dir={direction} className="wd-modal-overlay" UNSTABLE_portalContainer={portalContainer ?? undefined}><Modal className="wd-modal"><Dialog className="wd-dialog" aria-label={title}>{({ close }) => <><header><div><Heading slot="title">{title}</Heading>{description ? <p>{description}</p> : null}</div><IconButton aria-label={t("Close dialog")} onPress={close}><X size={17} /></IconButton></header><div className="wd-dialog-body">{children}</div>{footer ? <footer>{footer}</footer> : null}</>}</Dialog></Modal></ModalOverlay></DialogTrigger>;
}

export function AlertDialog({ body, confirmLabel, onConfirm, title, trigger }: { body: ReactNode; confirmLabel: string; onConfirm: () => void; title: string; trigger: ReactNode }) {
  return <ModalDialog footer={<DialogCloseActions confirmLabel={confirmLabel} onConfirm={onConfirm} />} title={title} trigger={trigger}>{body}</ModalDialog>;
}

// Open dialogs hold the page still. A count, not saved styles: the dialog library locks the page too,
// so "putting back what was there" could put its lock back and leave the page unable to scroll.
let pageLocks = 0;
function lockPageScroll() {
  pageLocks += 1;
  document.body.style.overflow = "hidden";
  document.documentElement.style.overflow = "hidden";
}
function unlockPageScroll() {
  pageLocks = Math.max(0, pageLocks - 1);
  if (pageLocks) return;
  document.body.style.overflow = "";
  document.documentElement.style.overflow = "";
}

export function ControlledModalDialog({ children, className, description, footer, hideTitle = false, isDirty = false, isDismissable = true, isOpen, keepsDraft = false, onKeyDown, onOpenChange, size = "md", title }: ControlledModalDialogProps) {
  const t = useT();
  const { portalContainer, direction } = useDesignSystem();
  const portalTheme = usePortalThemeAttributes();
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!isOpen) return;
    lockPageScroll();
    return unlockPageScroll;
  }, [isOpen]);
  const requestClose = useCallback(() => { if (isDirty) setConfirming(true); else onOpenChange(false); }, [isDirty, onOpenChange]);
  const dialog = useRef<HTMLElement>(null);
  // ⌘/Ctrl+Enter submits the form in the dialog unless the dialog handles keys itself.
  const keyDown = useEffectEvent((event: globalThis.KeyboardEvent) => onKeyDown ? onKeyDown(event) : submitOnModEnter(event, dialog.current?.querySelector("form") ?? null));
  useEffect(() => {
    const element = dialog.current;
    if (!isOpen || !element) return;
    element.addEventListener("keydown", keyDown);
    return () => element.removeEventListener("keydown", keyDown);
  }, [isOpen]);
  return <DialogCloseContext.Provider value={requestClose}>
    <ModalOverlay key={portalKey(portalContainer)} {...portalTheme} dir={direction} className="wd-modal-overlay" isDismissable={isDismissable} isOpen={isOpen} onOpenChange={(open) => open ? onOpenChange(true) : requestClose()} UNSTABLE_portalContainer={portalContainer ?? undefined}><Modal className={["wd-modal", className].filter(Boolean).join(" ")} data-size={size}><Dialog className="wd-dialog" aria-label={title} ref={dialog}>{() => <><header className={hideTitle ? "wd-dialog-minimal-header" : undefined}>{hideTitle ? null : <div><Heading slot="title">{title}</Heading>{description ? <p>{description}</p> : null}</div>}<IconButton aria-label={t("Close dialog")} onPress={requestClose}><X size={17} /></IconButton></header><div className="wd-dialog-body">{children}</div>{footer ? <footer>{footer}</footer> : null}</>}</Dialog></Modal></ModalOverlay>
    {isDirty || confirming ? <ConfirmationDialog isOpen={confirming} onOpenChange={setConfirming}
      title={keepsDraft ? t("Close this form?") : t("Discard unsaved changes?")}
      body={keepsDraft ? t("Your changes stay here as a draft until you save or discard them.") : t("Your saved records will stay as they are. Unsaved changes will be discarded.")}
      confirmLabel={keepsDraft ? t("Close") : t("Discard changes")} confirmVariant={keepsDraft ? "primary" : "danger"} cancelLabel={t("Keep editing")}
      onConfirm={() => { setConfirming(false); onOpenChange(false); }} /> : null}
  </DialogCloseContext.Provider>;
}

/**
 * Asks before an action. The dismiss button says "Cancel"; a confirmation about unsaved edits passes
 * `cancelLabel={t("Keep editing")}`, since there dismissing means going back to the edits.
 */
export function ConfirmationDialog({ body, cancelLabel, confirmLabel, confirmVariant = "danger", isConfirming = false, isOpen, onConfirm, onOpenChange, title }: { body: ReactNode; cancelLabel?: string; confirmLabel: string; confirmVariant?: "primary" | "danger"; isConfirming?: boolean; isOpen: boolean; onConfirm: () => void; onOpenChange: (open: boolean) => void; title: string }) {
  const t = useT();
  return <ControlledModalDialog footer={<div className="wd-dialog-actions"><Button isDisabled={isConfirming} onPress={() => onOpenChange(false)}>{cancelLabel ?? t("Cancel")}</Button><Button isLoading={isConfirming} onPress={onConfirm} variant={confirmVariant}>{confirmLabel}</Button></div>} isOpen={isOpen} onOpenChange={onOpenChange} title={title}>{body}</ControlledModalDialog>;
}

type ConfirmationRequest = {
  body: ReactNode;
  /** The dismiss button; "Cancel" unless the request is the default discard of unsaved edits ("Keep editing"). */
  cancelLabel?: string;
  confirmLabel?: string;
  confirmVariant?: "primary" | "danger";
  onConfirm: () => void;
  title: string;
};

/** Branded, asynchronous replacement for browser confirm dialogs. */
export function useConfirmationDialog() {
  const t = useT();
  const [request, setRequest] = useState<ConfirmationRequest | null>(null);
  const requestConfirmation = useCallback((next: ConfirmationRequest) => setRequest(next), []);
  const confirmationDialog = (
    <ConfirmationDialog
      body={request?.body ?? ""}
      confirmLabel={request?.confirmLabel ?? t("Discard changes")}
      cancelLabel={request?.cancelLabel ?? (request?.confirmLabel ? undefined : t("Keep editing"))}
      confirmVariant={request?.confirmVariant}
      isOpen={Boolean(request)}
      onConfirm={() => {
        const action = request?.onConfirm;
        setRequest(null);
        action?.();
      }}
      onOpenChange={(open) => { if (!open) setRequest(null); }}
      title={request?.title ?? t("Confirm action")}
    />
  );
  return { confirmationDialog, requestConfirmation };
}

function DialogCloseActions({ confirmLabel, onConfirm }: { confirmLabel: string; onConfirm: () => void }) {
  const t = useT();
  return <div className="wd-dialog-actions"><Button slot="close">{t("Cancel")}</Button><Button onPress={onConfirm} slot="close" variant="danger">{confirmLabel}</Button></div>;
}

export type SideSheetSize = "sm" | "md" | "lg" | "xl";
export type SideSheetSide = "inline-start" | "inline-end" | "bottom";
export type SideSheetProps = Omit<DialogTriggerProps, "children"> & {
  children: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  isDirty?: boolean;
  side?: SideSheetSide;
  size?: SideSheetSize;
  title: string;
  trigger: ReactNode;
};

export function SideSheet({ children, defaultOpen, description, footer, isDirty = false, isOpen: controlledOpen, onOpenChange, side = "inline-end", size = "md", title, trigger, ...props }: SideSheetProps) {
  const t = useT();
  const { portalContainer, direction } = useDesignSystem();
  const portalTheme = usePortalThemeAttributes();
  const [internalOpen, setInternalOpen] = useState(defaultOpen ?? false);
  const { confirmationDialog, requestConfirmation } = useConfirmationDialog();
  const isOpen = controlledOpen ?? internalOpen;
  const close = () => {
    if (controlledOpen === undefined) setInternalOpen(false);
    onOpenChange?.(false);
  };
  const requestChange = (nextOpen: boolean) => {
    if (!nextOpen && isDirty) {
      requestConfirmation({ title: t("Discard unsaved changes?"), body: t("Your saved records will stay as they are. Unsaved changes will be discarded."), onConfirm: close });
      return;
    }
    if (controlledOpen === undefined) setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };
  const overlayClass = side === "bottom" ? "wd-sheet-overlay wd-sheet-overlay-bottom" : side === "inline-start" ? "wd-sheet-overlay wd-sheet-overlay-start" : "wd-sheet-overlay";
  return <><DialogTrigger {...props} isOpen={isOpen} onOpenChange={requestChange}><>{trigger}</><ModalOverlay key={portalKey(portalContainer)} {...portalTheme} dir={direction} className={overlayClass} isDismissable UNSTABLE_portalContainer={portalContainer ?? undefined}><Modal className="wd-side-sheet" data-side={side} data-size={size}><Dialog className="wd-sheet-dialog">{() => <><header><div><Heading slot="title">{title}</Heading>{description ? <p>{description}</p> : null}</div><IconButton aria-label={t("Close inspector")} onPress={() => requestChange(false)}><X size={17} /></IconButton></header><div className="wd-sheet-body">{children}</div>{footer ? <footer>{footer}</footer> : null}</>}</Dialog></Modal></ModalOverlay></DialogTrigger>{confirmationDialog}</>;
}

export function Drawer(props: SideSheetProps) { return <SideSheet {...props} side="inline-start" />; }
export function BottomSheet(props: SideSheetProps) { return <SideSheet {...props} side="bottom" />; }

export type InspectorSheetProps = Pick<SideSheetProps, "children" | "description" | "footer" | "isDirty" | "size" | "title"> & { isOpen: boolean; onOpenChange: (open: boolean) => void };
export function InspectorSheet({ children, description, footer, hideTitle = false, isDirty = false, isOpen, onOpenChange, size = "md", title }: InspectorSheetProps & { /** The record's own header names it; keep the title for screen readers only. */ hideTitle?: boolean }) {
  const t = useT();
  const { portalContainer, direction } = useDesignSystem();
  const portalTheme = usePortalThemeAttributes();
  const [discardOpen,setDiscardOpen]=useState(false);
  const requestClose = () => {
    if (isDirty) {setDiscardOpen(true);return;}
    onOpenChange(false);
  };
  return <DialogCloseContext.Provider value={requestClose}><ModalOverlay key={portalKey(portalContainer)} {...portalTheme} dir={direction} className="wd-sheet-overlay" isDismissable isOpen={isOpen} onOpenChange={(open) => open ? onOpenChange(true) : requestClose()} UNSTABLE_portalContainer={portalContainer ?? undefined}><Modal className="wd-side-sheet" data-size={size}><Dialog className="wd-sheet-dialog">{() => <><header data-minimal={hideTitle || undefined}><div className={hideTitle ? "wd-visually-hidden" : undefined}><Heading slot="title">{title}</Heading>{description ? <p>{description}</p> : null}</div><IconButton aria-label={t("Close inspector")} onPress={requestClose}><X size={17} /></IconButton></header><div className="wd-sheet-body">{children}</div>{footer ? <footer>{footer}</footer> : null}</>}</Dialog></Modal></ModalOverlay><ConfirmationDialog isOpen={discardOpen} onOpenChange={setDiscardOpen} title={t("Discard unsaved changes?")} body={t("Your saved records will stay as they are. Unsaved changes will be discarded.")} confirmLabel={t("Discard changes")} cancelLabel={t("Keep editing")} onConfirm={()=>{setDiscardOpen(false);onOpenChange(false);}}/></DialogCloseContext.Provider>;
}
