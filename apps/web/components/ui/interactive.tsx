"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Avatar } from "./avatar";
import { Badge } from "./badge";
import { Button, IconButton } from "./button";
import { Icon } from "./icon";
import styles from "./ui.module.css";

export function Switch({ defaultChecked = false, label }: { defaultChecked?: boolean; label: string }) {
  const [checked, setChecked] = useState(defaultChecked);
  return (
    <button
      aria-label={label}
      aria-checked={checked}
      className={`${styles.switch} ${checked ? styles.switchOn : ""}`}
      onClick={() => setChecked((value) => !value)}
      role="switch"
      type="button"
    >
      <span className={styles.switchThumb} />
    </button>
  );
}

export type TabItem = { id: string; label: string; content: React.ReactNode };

export function Tabs({ defaultTab, items, label }: { defaultTab?: string; items: TabItem[]; label: string }) {
  const [active, setActive] = useState(defaultTab ?? items[0]?.id);
  const baseId = useId();
  const selectRelative = (currentIndex: number, offset: number) => {
    const nextIndex = (currentIndex + offset + items.length) % items.length;
    setActive(items[nextIndex]?.id);
    document.getElementById(`${baseId}-tab-${items[nextIndex]?.id}`)?.focus();
  };
  return (
    <div>
      <div aria-label={label} className={styles.tabs} role="tablist">
        {items.map((item, index) => (
          <button
            aria-controls={`${baseId}-panel-${item.id}`}
            aria-selected={active === item.id}
            className={`${styles.tab} ${active === item.id ? styles.tabActive : ""}`}
            id={`${baseId}-tab-${item.id}`}
            key={item.id}
            onClick={() => setActive(item.id)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") { event.preventDefault(); selectRelative(index, 1); }
              if (event.key === "ArrowLeft") { event.preventDefault(); selectRelative(index, -1); }
            }}
            role="tab"
            tabIndex={active === item.id ? 0 : -1}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>
      {items.map((item) => active === item.id ? (
        <div
          aria-labelledby={`${baseId}-tab-${item.id}`}
          className={styles.tabPanel}
          id={`${baseId}-panel-${item.id}`}
          key={item.id}
          role="tabpanel"
        >
          {item.content}
        </div>
      ) : null)}
    </div>
  );
}

export type AccordionItem = { id: string; title: string; content: React.ReactNode };

export function Accordion({ defaultOpen, items }: { defaultOpen?: string; items: AccordionItem[] }) {
  const [open, setOpen] = useState<string | null>(defaultOpen ?? items[0]?.id ?? null);
  const baseId = useId();
  return (
    <div className={styles.accordion}>
      {items.map((item) => {
        const expanded = open === item.id;
        return (
          <div className={styles.accordionItem} key={item.id}>
            <button
              aria-controls={`${baseId}-${item.id}`}
              aria-expanded={expanded}
              className={styles.accordionButton}
              onClick={() => setOpen(expanded ? null : item.id)}
              type="button"
            >
              {item.title}
              <Icon className={`${styles.accordionChevron} ${expanded ? styles.accordionChevronOpen : ""}`} name="chevron-down" />
            </button>
            <div
              className={`${styles.accordionContent} ${expanded ? styles.accordionContentOpen : ""}`}
              id={`${baseId}-${item.id}`}
            >
              <div className={styles.accordionContentInner}><div>{item.content}</div></div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function RangeSlider({ defaultValue = 68, label }: { defaultValue?: number; label: string }) {
  const [value, setValue] = useState(defaultValue);
  const id = useId();
  return (
    <div>
      <label className={styles.label} htmlFor={id}>{label}</label>
      <div className={styles.rangeRow}>
        <input
          className={styles.range}
          id={id}
          max="100"
          min="0"
          onInput={(event) => setValue(Number(event.currentTarget.value))}
          style={{ "--range-progress": `${value}%` } as React.CSSProperties}
          type="range"
          value={value}
        />
        <output className={styles.rangeValue} htmlFor={id}>{value}%</output>
      </div>
    </div>
  );
}

export function DirectionPreview() {
  const [direction, setDirection] = useState<"ltr" | "rtl">("ltr");
  const rtl = direction === "rtl";

  return (
    <div className={styles.directionDemo}>
      <div aria-label="Text direction" className={styles.directionToggle} role="group">
        <button aria-pressed={!rtl} onClick={() => setDirection("ltr")} type="button">LTR · English</button>
        <button aria-pressed={rtl} onClick={() => setDirection("rtl")} type="button">RTL · العربية</button>
      </div>
      <div className={styles.directionCanvas} dir={direction} lang={rtl ? "ar" : "en"}>
        <div>
          <small>{rtl ? "موافقة العميل" : "Client approval"}</small>
          <h3>{rtl ? "تصميم غرفة المعيشة جاهز" : "Living room design is ready"}</h3>
          <p>{rtl ? "راجع المخطط والمواد قبل إرسال الموافقة إلى فريق الإنتاج." : "Review the layout and materials before releasing the approval to production."}</p>
        </div>
        <div className={styles.directionActions}>
          <Badge dot tone="warning">{rtl ? "بحاجة للمراجعة" : "Needs review"}</Badge>
          <Button>{rtl ? "فتح الموافقة" : "Open approval"} <Icon name="arrow-right" /></Button>
        </div>
      </div>
    </div>
  );
}

export function DialogDemo() {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <Button onClick={() => dialog.current?.showModal()} variant="secondary">Open approval summary</Button>
      <dialog className={styles.dialog} onClick={(event) => {
        if (event.target === event.currentTarget) event.currentTarget.close();
      }} ref={dialog}>
        <div className={styles.dialogHead}>
          <div>
            <p className={styles.optional}>Client approval</p>
            <h3 className={styles.dialogTitle}>Send BOQ for approval?</h3>
          </div>
          <IconButton aria-label="Close dialog" onClick={() => dialog.current?.close()}><Icon name="close" /></IconButton>
        </div>
        <p className={styles.dialogCopy}>
          Meera Shah will receive version 3 with a total of ₹12,65,432. Earlier links will remain in the audit history but cannot be approved.
        </p>
        <div className={styles.dialogActions}>
          <Button onClick={() => dialog.current?.close()} variant="ghost">Cancel</Button>
          <Button onClick={() => dialog.current?.close()}>Send for approval <Icon name="arrow-right" /></Button>
        </div>
      </dialog>
    </>
  );
}

const slides = [
  { quote: "The next action stays obvious, even when the project is complex.", meta: "Workflow principle · Clarity" },
  { quote: "Automation prepares the work. A person approves the important decision.", meta: "AI principle · Control" },
  { quote: "One calm table should replace a page full of disconnected cards.", meta: "Data principle · Density" },
];

export function AnimatedCarousel() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setActive((value) => (value + 1) % slides.length), 5000);
    return () => window.clearInterval(timer);
  }, [paused]);
  const move = (offset: number) => setActive((value) => (value + offset + slides.length) % slides.length);
  return (
    <div
      aria-label="Wodana interface principles"
      aria-roledescription="carousel"
      className={styles.carousel}
      onBlur={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className={styles.carouselViewport}>
        <div className={styles.carouselTrack} style={{ transform: `translateX(-${active * 100}%)` }}>
          {slides.map((slide, index) => (
            <article aria-hidden={active !== index} className={styles.carouselSlide} key={slide.meta}>
              <p className={styles.carouselEyebrow}>Interface principle 0{index + 1}</p>
              <blockquote className={styles.carouselQuote}>{slide.quote}</blockquote>
              <div className={styles.carouselMeta}><span>{slide.meta}</span><Avatar label="W" name="Wodana" size="sm" /></div>
            </article>
          ))}
        </div>
      </div>
      <div className={styles.carouselControls}>
        <div className={styles.dots}>
          {slides.map((slide, index) => (
            <button
              aria-label={`Show ${slide.meta}`}
              className={`${styles.dotButton} ${index === active ? styles.dotButtonActive : ""}`}
              key={slide.meta}
              onClick={() => setActive(index)}
              type="button"
            />
          ))}
        </div>
        <div className={styles.controlGroup}>
          <IconButton aria-label="Previous principle" onClick={() => move(-1)}><Icon name="chevron-left" /></IconButton>
          <IconButton aria-label="Next principle" onClick={() => move(1)}><Icon name="chevron-right" /></IconButton>
        </div>
      </div>
    </div>
  );
}
