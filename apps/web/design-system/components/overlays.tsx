"use client";

import { useEffect, useState, type ReactNode } from "react";
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
import { useDesignSystem } from "../foundations/provider";
import { Button, IconButton } from "./actions";

export function TooltipBubble({ children, content }: { children: ReactNode; content: ReactNode }) {
  return <TooltipTrigger delay={450}><span>{children}</span><Tooltip className="wd-tooltip" offset={6}>{content}</Tooltip></TooltipTrigger>;
}

export function PopoverSurface({ children }: { children: ReactNode }) { return <Popover className="wd-popover">{children}</Popover>; }

type ModalDialogProps = Omit<DialogTriggerProps, "children"> & {
  children: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  title: string;
  trigger: ReactNode;
};

type ControlledModalDialogProps = {
  children: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  isDismissable?: boolean;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  size?: "md" | "lg" | "xl";
  title: string;
};

export function ModalDialog({ children, description, footer, title, trigger, ...props }: ModalDialogProps) {
  const { portalContainer } = useDesignSystem();
  return <DialogTrigger {...props}><>{trigger}</><ModalOverlay className="wd-modal-overlay" UNSTABLE_portalContainer={portalContainer ?? undefined}><Modal className="wd-modal"><Dialog className="wd-dialog" aria-label={title}>{({ close }) => <><header><div><Heading slot="title">{title}</Heading>{description ? <p>{description}</p> : null}</div><IconButton aria-label="Close dialog" onPress={close}><X size={17} /></IconButton></header><div className="wd-dialog-body">{children}</div>{footer ? <footer>{footer}</footer> : null}</>}</Dialog></Modal></ModalOverlay></DialogTrigger>;
}

export function AlertDialog({ body, confirmLabel, onConfirm, title, trigger }: { body: ReactNode; confirmLabel: string; onConfirm: () => void; title: string; trigger: ReactNode }) {
  return <ModalDialog footer={<DialogCloseActions confirmLabel={confirmLabel} onConfirm={onConfirm} />} title={title} trigger={trigger}>{body}</ModalDialog>;
}

export function ControlledModalDialog({ children, description, footer, isDismissable = true, isOpen, onOpenChange, size = "md", title }: ControlledModalDialogProps) {
  const { portalContainer } = useDesignSystem();
  useEffect(() => {
    if (!isOpen) return;
    const bodyOverflow = document.body.style.overflow;
    const rootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = bodyOverflow;
      document.documentElement.style.overflow = rootOverflow;
    };
  }, [isOpen]);
  return <ModalOverlay className="wd-modal-overlay" isDismissable={isDismissable} isOpen={isOpen} onOpenChange={onOpenChange} UNSTABLE_portalContainer={portalContainer ?? undefined}><Modal className="wd-modal" data-size={size}><Dialog className="wd-dialog" aria-label={title}>{() => <><header><div><Heading slot="title">{title}</Heading>{description ? <p>{description}</p> : null}</div><IconButton aria-label="Close dialog" onPress={() => onOpenChange(false)}><X size={17} /></IconButton></header><div className="wd-dialog-body">{children}</div>{footer ? <footer>{footer}</footer> : null}</>}</Dialog></Modal></ModalOverlay>;
}

export function ConfirmationDialog({ body, confirmLabel, isOpen, onConfirm, onOpenChange, title }: { body: ReactNode; confirmLabel: string; isOpen: boolean; onConfirm: () => void; onOpenChange: (open: boolean) => void; title: string }) {
  return <ControlledModalDialog footer={<div className="wd-dialog-actions"><Button onPress={() => onOpenChange(false)}>Keep editing</Button><Button onPress={onConfirm} variant="danger">{confirmLabel}</Button></div>} isOpen={isOpen} onOpenChange={onOpenChange} title={title}>{body}</ControlledModalDialog>;
}

function DialogCloseActions({ confirmLabel, onConfirm }: { confirmLabel: string; onConfirm: () => void }) {
  return <div className="wd-dialog-actions"><Button slot="close">Cancel</Button><Button onPress={onConfirm} slot="close" variant="danger">{confirmLabel}</Button></div>;
}

export type SideSheetSize = "sm" | "md" | "lg";
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
  const { portalContainer } = useDesignSystem();
  const [internalOpen, setInternalOpen] = useState(defaultOpen ?? false);
  const isOpen = controlledOpen ?? internalOpen;
  const requestChange = (nextOpen: boolean) => {
    if (!nextOpen && isDirty && !window.confirm("Discard unsaved changes?")) return;
    if (controlledOpen === undefined) setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };
  const overlayClass = side === "bottom" ? "wd-sheet-overlay wd-sheet-overlay-bottom" : side === "inline-start" ? "wd-sheet-overlay wd-sheet-overlay-start" : "wd-sheet-overlay";
  return <DialogTrigger {...props} isOpen={isOpen} onOpenChange={requestChange}><>{trigger}</><ModalOverlay className={overlayClass} isDismissable UNSTABLE_portalContainer={portalContainer ?? undefined}><Modal className="wd-side-sheet" data-side={side} data-size={size}><Dialog className="wd-sheet-dialog">{() => <><header><div><Heading slot="title">{title}</Heading>{description ? <p>{description}</p> : null}</div><IconButton aria-label="Close inspector" onPress={() => requestChange(false)}><X size={17} /></IconButton></header><div className="wd-sheet-body">{children}</div>{footer ? <footer>{footer}</footer> : null}</>}</Dialog></Modal></ModalOverlay></DialogTrigger>;
}

export function Drawer(props: SideSheetProps) { return <SideSheet {...props} side="inline-start" />; }
export function BottomSheet(props: SideSheetProps) { return <SideSheet {...props} side="bottom" />; }

export type InspectorSheetProps = Pick<SideSheetProps, "children" | "description" | "footer" | "isDirty" | "size" | "title"> & { isOpen: boolean; onOpenChange: (open: boolean) => void };
export function InspectorSheet({ children, description, footer, isDirty = false, isOpen, onOpenChange, size = "md", title }: InspectorSheetProps) {
  const { portalContainer } = useDesignSystem();
  const [discardOpen,setDiscardOpen]=useState(false);
  const requestClose = () => {
    if (isDirty) {setDiscardOpen(true);return;}
    onOpenChange(false);
  };
  return <><ModalOverlay className="wd-sheet-overlay" isDismissable isOpen={isOpen} onOpenChange={(open) => open ? onOpenChange(true) : requestClose()} UNSTABLE_portalContainer={portalContainer ?? undefined}><Modal className="wd-side-sheet" data-size={size}><Dialog className="wd-sheet-dialog">{() => <><header><div><Heading slot="title">{title}</Heading>{description ? <p>{description}</p> : null}</div><IconButton aria-label="Close inspector" onPress={requestClose}><X size={17} /></IconButton></header><div className="wd-sheet-body">{children}</div>{footer ? <footer>{footer}</footer> : null}</>}</Dialog></Modal></ModalOverlay><ConfirmationDialog isOpen={discardOpen} onOpenChange={setDiscardOpen} title="Discard unsaved changes?" body="Your saved records will stay as they are. Unsaved changes will be discarded." confirmLabel="Discard changes" onConfirm={()=>{setDiscardOpen(false);onOpenChange(false);}}/></>;
}
