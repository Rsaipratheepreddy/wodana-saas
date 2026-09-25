'use client';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { AlignCenter, AlignLeft, AlignRight, Copy, ImagePlus, Minus, Plus, Trash2, Type, Move, Check, Palette, Bold, Italic, Underline, List, ListOrdered, ImageOff } from 'lucide-react';
import type { Quote, QuoteCanvasElement, QuoteCanvasPage } from '@/lib/commercial/types';
import type { Editor } from '@tiptap/react';
import { QuotationRichTextEditor, QuoteRichText } from './quotation-rich-text';
import { QuotationLinkedBlock } from './quotation-linked-block';
import { referenceItemPage } from '@/lib/commercial/quotation-reference-template';
import styles from './quotation-page-designer.module.css';
const WIDTH = 940, HEIGHT = 1329;
export function QuotationPageDesigner({ quote, pageId, readOnly, onChange, onEditPayments, continuous = false, active = true, onActivate, inspectorHost, onEditDetails, onEditScope }: {
    quote: Quote;
    pageId: string;
    readOnly: boolean;
    onChange: (quote: Quote, checkpoint?: boolean) => void;
    onEditPayments?: () => void;
    continuous?: boolean;
    active?: boolean;
    onActivate?: () => void;
    inspectorHost?: HTMLElement | null;
    onEditDetails?: () => void;
    onEditScope?: () => void;
}) {
    const design = quote.presentation!;
    const page = (design.pages.find(page => page.id === pageId) ?? (design.template === 'palm-reference-v1' && pageId.startsWith('items:') ? referenceItemPage(Number(pageId.slice(6))) : undefined))!;
    const [richEditor, setRichEditor] = useState<Editor | null>(null);
    const [selected, setSelected] = useState('__page__'), [editing, setEditing] = useState(''), [zoom, setZoom] = useState(.6), [error, setError] = useState('');
    const [moving, setMoving] = useState<QuoteCanvasElement | null>(null), [uploading, setUploading] = useState(false);
    const stage = useRef<HTMLDivElement>(null), fileInput = useRef<HTMLInputElement>(null), backgroundInput = useRef<HTMLInputElement>(null);
    const latest = useRef(quote);
    latest.current = quote;
    const drag = useRef<{
        id: string;
        x: number;
        y: number;
        element: QuoteCanvasElement;
        resize: boolean;
        next: QuoteCanvasElement;
    } | null>(null);
    const current = page?.elements.find(element => element.id === selected);
    function fit() { const box = stage.current?.getBoundingClientRect(); if (box)
        setZoom(Math.min(1, Math.max(.2, Math.min((box.width - 48) / WIDTH, continuous ? Math.max(420,window.innerHeight-190)/HEIGHT : (box.height - 190) / HEIGHT)))); }
    useEffect(() => { fit(); const observer = new ResizeObserver(() => fit()); if (stage.current)
        observer.observe(stage.current); return () => observer.disconnect(); }, []);
    function patchPage(patch: Partial<QuoteCanvasPage>, checkpoint = false) {
        if (readOnly)
            return;
        const base = latest.current, exists = base.presentation!.pages.some(item => item.id === pageId);
        onChange({ ...base, presentation: { ...base.presentation!, pages: exists ? base.presentation!.pages.map(item => item.id === pageId ? { ...item, ...patch } : item) : [...base.presentation!.pages, { ...page!, ...patch }] } }, checkpoint);
    }
    function patchElement(id: string, patch: Partial<QuoteCanvasElement>, checkpoint = false) { const latestPage = latest.current.presentation!.pages.find(item => item.id === pageId) ?? page!; const elements = latestPage.elements.map(element => element.id === id ? { ...element, ...patch } : element); if (id.startsWith('field:') && patch.text !== undefined) {
        const field = id.slice(6),root=field.startsWith('terms-')?'terms':field.split(':')[0];
        if (['terms', 'inclusions', 'exclusions'].includes(root)) {
            const base = latest.current,pages=base.presentation!.pages.map(item => item.id === pageId ? { ...item, elements } : item);
            const value=pages.flatMap(item=>item.elements).filter(element=>element.id===`field:${root}`||element.id.startsWith(`field:${root}${root==='terms'?'-':':'}`)).map(element=>element.text??'').join('\n\n');
            onChange({ ...base, [root]:value,presentation: { ...base.presentation!, pages } }, checkpoint);
            return;
        }
    } patchPage({ elements }, checkpoint); }
    function addText() { const element: QuoteCanvasElement = { id: crypto.randomUUID(), type: 'text', x: 100, y: 170, width: 650, height: 110, text: 'Your text', fontSize: 36, color: '#25382f', align: 'left' }; patchPage({ elements: [...page.elements, element] }, true); setSelected(element.id); setEditing(element.id); }
    function remove() { if (!current)
        return; patchPage({ elements: page.elements.filter(element => element.id !== current.id) }, true); setSelected(''); setEditing(''); }
    function duplicate() { if (!current || page.elements.length >= 100)
        return; const element = { ...current, id: crypto.randomUUID(), x: Math.min(WIDTH - current.width, current.x + 24), y: Math.min(HEIGHT - current.height, current.y + 24) }; patchPage({ elements: [...page.elements, element] }, true); setSelected(element.id); setEditing(''); }
    function start(event: ReactPointerEvent<HTMLDivElement>, element: QuoteCanvasElement, resize = false) {
        if (readOnly || editing === element.id || event.button !== 0)
            return;
        event.preventDefault();
        event.stopPropagation();
        setSelected(element.id);
        setEditing('');
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { id: element.id, x: event.clientX, y: event.clientY, element, resize, next: element };
    }
    function motion(event: ReactPointerEvent<HTMLDivElement>) {
        const entry = drag.current;
        if (!entry)
            return;
        const dx = (event.clientX - entry.x) / zoom, dy = (event.clientY - entry.y) / zoom;
        const element = entry.element;
        entry.next = entry.resize ? { ...element, width: Math.max(24, Math.min(WIDTH - element.x, element.width + dx)), height: Math.max(24, Math.min(HEIGHT - element.y, element.height + dy)) } : { ...element, x: Math.max(0, Math.min(WIDTH - element.width, element.x + dx)), y: Math.max(0, Math.min(HEIGHT - element.height, element.y + dy)) };
        setMoving(entry.next);
    }
    function finish() { const entry = drag.current; if (!entry)
        return; drag.current = null; setMoving(null); if (JSON.stringify(entry.next) !== JSON.stringify(entry.element))
        patchElement(entry.id, entry.next, true); }
    async function upload(file?: File, background = false) {
        if (!file || readOnly)
            return;
        setError('');
        setUploading(true);
        try {
            if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024)
                throw new Error('Choose a PNG, JPEG or WebP under 8 MB.');
            const bitmap = await createImageBitmap(file);
            const scale = Math.min(1, 1500 / Math.max(bitmap.width, bitmap.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(bitmap.width * scale);
            canvas.height = Math.round(bitmap.height * scale);
            canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            bitmap.close();
            let src = '';
            for (const quality of [.85, .65, .45, .25]) {
                src = canvas.toDataURL('image/webp', quality);
                if (src.length < 450000)
                    break;
            }
            if (src.length > 450000)
                throw new Error('This image is too large. Try a smaller image.');
            const base = latest.current, latestPage = base.presentation!.pages.find(item => item.id === pageId) ?? page!;
            const used = base.presentation!.pages.reduce((total, item) => total + (item.backgroundImage?.length ?? 0) + item.elements.reduce((sum, element) => sum + (element.src?.length ?? 0), 0), base.presentation!.details?.clientLogo?.length??0);
            if (used + src.length - (background ? (latestPage.backgroundImage?.length ?? 0) : 0) > 1500000)
                throw new Error('These page images exceed the quotation limit. Use smaller images.');
            if (background) {
                patchPage({ backgroundImage: src }, true);
                setSelected('__page__');
                setEditing('');
                return;
            }
            const width = Math.min(600, canvas.width), height = Math.min(900, width * canvas.height / canvas.width);
            const element: QuoteCanvasElement = { id: crypto.randomUUID(), type: 'image', x: 100, y: 180, width: Math.min(width, height * canvas.width / canvas.height), height, src };
            patchPage({ elements: [...latestPage.elements, element] }, true);
            setSelected(element.id);
            setEditing('');
        }
        catch (error) {
            setError(error instanceof Error ? error.message : 'Could not add image.');
        }
        finally {
            setUploading(false);
            if (fileInput.current)
                fileInput.current.value = '';
        }
    }
    if (!page)
        return null;
    const controls = <>
  {!readOnly && <div className={styles.tools} aria-label="Page tools">
   <button type="button" onClick={addText} disabled={page.elements.length >= 100}><Type size={16}/>Text</button>
   <button type="button" onClick={() => fileInput.current?.click()} disabled={uploading || page.elements.length >= 100}><ImagePlus size={16}/>{uploading ? 'Adding…' : 'Image'}</button>
   <button type="button" aria-pressed={selected === '__page__'} onClick={() => { setSelected('__page__'); setEditing(''); }}><Palette size={16}/>Page</button>
   <input ref={fileInput} hidden type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload page image" onChange={event => void upload(event.target.files?.[0])}/>
  </div>}
  {selected === '__page__' && !readOnly && <div className={styles.context} aria-label="Page background controls">
   <label className={styles.colour}><input aria-label="Page colour" type="color" value={page.background ?? design.pageBackground} onChange={event => patchPage({ background: event.target.value })}/>Background</label>
   <button type="button" disabled={uploading} onClick={() => backgroundInput.current?.click()}><ImagePlus size={15}/>{uploading ? 'Adding…' : 'Background image'}</button>
   {page.backgroundImage && <button type="button" onClick={() => patchPage({ backgroundImage: undefined }, true)}><ImageOff size={15}/>Remove image</button>}
  </div>}
  <input ref={backgroundInput} hidden type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload background image" onChange={event => { void upload(event.target.files?.[0], true); event.currentTarget.value = ''; }}/>
  {current && !readOnly && <div className={styles.context} aria-label="Selection controls">
   {current.type === 'text' && !current.id.startsWith('data:') && <>
    {editing && <>
     <button type="button" aria-label="Bold" aria-pressed={richEditor?.isActive('bold') ?? false} onClick={() => richEditor?.chain().focus().toggleBold().run()}><Bold size={15}/></button>
     <button type="button" aria-label="Italic" aria-pressed={richEditor?.isActive('italic') ?? false} onClick={() => richEditor?.chain().focus().toggleItalic().run()}><Italic size={15}/></button>
     <button type="button" aria-label="Underline" aria-pressed={richEditor?.isActive('underline') ?? false} onClick={() => richEditor?.chain().focus().toggleUnderline().run()}><Underline size={15}/></button>
     <button type="button" aria-label="Bullet list" aria-pressed={richEditor?.isActive('bulletList') ?? false} onClick={() => richEditor?.chain().focus().toggleBulletList().run()}><List size={15}/></button>
     <button type="button" aria-label="Numbered list" aria-pressed={richEditor?.isActive('orderedList') ?? false} onClick={() => richEditor?.chain().focus().toggleOrderedList().run()}><ListOrdered size={15}/></button>
    </>}
    <label className={styles.size}><input aria-label="Font size" type="number" min={8} max={96} value={current.fontSize ?? 28} onChange={event => patchElement(current.id, { fontSize: Math.min(96, Math.max(8, Number(event.target.value) || 8)) })}/>px</label>
    <input aria-label="Text colour" type="color" value={current.color ?? '#25382f'} onChange={event => patchElement(current.id, { color: event.target.value })}/>
    {(['left', 'center', 'right'] as const).map(align => { const Icon = align === 'left' ? AlignLeft : align === 'center' ? AlignCenter : AlignRight; return <button type="button" key={align} aria-label={`Align ${align}`} aria-pressed={(current.align ?? 'left') === align} onClick={() => patchElement(current.id, { align })}><Icon size={15}/></button>; })}
    <button type="button" onClick={() => setEditing(editing ? '' : current.id)}>{editing ? <Check size={15}/> : <Type size={15}/>} {editing ? 'Done' : 'Edit text'}</button>
   </>}
   <button type="button" aria-label="Duplicate element" onClick={duplicate} disabled={page.elements.length >= 100}><Copy size={15}/></button><button type="button" aria-label="Delete element" onClick={remove}><Trash2 size={15}/></button>
  </div>}
  {error && <p className={styles.error} role="alert">{error}<button type="button" onClick={() => setError('')}>Dismiss</button></p>}
  {current?.id.startsWith('data:') && <button type="button" onClick={() => current.id.includes('items:') ? onEditScope?.() : onEditDetails?.()}>{current.id.includes('items:') ? 'Edit scope & items' : 'Edit client & project details'}</button>}
  </>;
    return <div className={styles.designer} data-continuous={continuous || undefined} ref={stage} aria-label={`Page editor ${pageId}`} onFocusCapture={onActivate} onPointerDownCapture={onActivate} onPointerDown={event => { if (event.target === event.currentTarget) {
        setSelected('__page__');
        setEditing('');
    } }}>
  {continuous ? (active && inspectorHost ? createPortal(<div className={styles.inspector}>{controls}</div>, inspectorHost) : null) : controls}
  <div className={styles.scroll} onPointerDown={event => { if (event.target === event.currentTarget) {
        setSelected('__page__');
        setEditing('');
    } }}>
   <div className={styles.paperSpace} style={{ width: WIDTH * zoom, height: HEIGHT * zoom }}>
    <div className={styles.paper} dir="ltr" style={{ width: WIDTH, height: HEIGHT, transform: `scale(${zoom})`, background: page.background ?? design.pageBackground, ...(page.backgroundImage ? { backgroundImage: `url(${page.backgroundImage})` } : {}) }} role="group" tabIndex={0} data-page-selected={selected === '__page__' || undefined} aria-label="Design page" onKeyDown={event => { if (event.target === event.currentTarget && event.key === 'Enter') {
        setSelected('__page__');
        setEditing('');
    } }} onPointerDown={event => { if (event.target === event.currentTarget) {
        setSelected('__page__');
        setEditing('');
    } }}>
     {page.elements.map(savedElement => {
            const element = moving?.id === savedElement.id ? moving : savedElement;
            return <div key={element.id} data-quotation-element={element.id} role="group" aria-label={element.type === 'image' ? 'Page image' : element.id.startsWith('data:')?'Linked quotation details':element.text || 'Text element'} tabIndex={readOnly ? -1 : 0} className={styles.element} data-selected={!readOnly && active && selected === element.id || undefined} data-editing={editing === element.id || undefined} style={{ left: element.x, top: element.y, width: element.width, height: element.height, color: element.color ?? design.textColor, fontSize: element.fontSize ?? 28, textAlign: element.align ?? 'left' }} onFocus={() => { if (!readOnly)
                setSelected(element.id); }} onClick={event => { event.stopPropagation(); if (!readOnly)
                setSelected(element.id); }} onDoubleClick={() => { if (element.id === 'data:payments') {
                onEditPayments?.();
                return;
            } if(element.id.startsWith('data:')){element.id.includes('items:')?onEditScope?.():onEditDetails?.();return;} if (!readOnly && element.type === 'text' && !element.id.startsWith('data:'))
                setEditing(element.id); }} onPointerDown={event => start(event, element)} onPointerMove={motion} onPointerUp={finish} onPointerCancel={() => { drag.current = null; setMoving(null); }} onKeyDown={event => {
                    if (readOnly || event.target !== event.currentTarget)
                        return;
                    if(event.key==='Enter'&&element.id.startsWith('data:')){event.preventDefault();element.id.includes('items:')?onEditScope?.():onEditDetails?.();return;}
                    if (event.key === 'Enter' && element.type === 'text' && !element.id.startsWith('data:')) {
                        event.preventDefault();
                        setEditing(element.id);
                        return;
                    }
                    if (event.key === 'Escape') {
                        setSelected('');
                        setEditing('');
                        return;
                    }
                    if (event.key === 'Delete' || event.key === 'Backspace') {
                        event.preventDefault();
                        patchPage({ elements: page.elements.filter(item => item.id !== element.id) }, true);
                        return;
                    }
                    const step = event.shiftKey ? 10 : 1;
                    const directions: Record<string, [
                        number,
                        number
                    ]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
                    const delta = directions[event.key];
                    if (delta) {
                        event.preventDefault();
                        patchElement(element.id, { x: Math.max(0, Math.min(WIDTH - element.width, element.x + delta[0])), y: Math.max(0, Math.min(HEIGHT - element.height, element.y + delta[1])) });
                    }
                }}>
      {element.id.startsWith('data:') ? <QuotationLinkedBlock id={element.id} quote={quote}/> : element.type === 'image' ? <img src={element.src} draggable={false} alt="Quotation artwork"/> : editing === element.id && !readOnly ? <div className={styles.rich} onPointerDown={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Escape') {
                setEditing('');
                event.stopPropagation();
            } }}><QuotationRichTextEditor value={element.richText} text={element.text ?? ''} onReady={setRichEditor} onChange={(richText, text) => patchElement(element.id, { richText, text })}/></div> : <div className={`${styles.text} ${styles.rich}`}>{element.richText ? <QuoteRichText node={element.richText}/> : element.text}</div>}
      {!readOnly && selected === element.id && editing !== element.id && <><span className={styles.move}><Move size={16}/></span><div role="slider" tabIndex={0} aria-label="Resize selected element" aria-valuemin={24} aria-valuemax={WIDTH} aria-valuenow={Math.round(element.width)} className={styles.handle} onPointerDown={event => start(event, element, true)} onKeyDown={event => { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                event.preventDefault();
                event.stopPropagation();
                patchElement(element.id, { width: Math.max(24, Math.min(WIDTH - element.x, element.width + (event.key === 'ArrowRight' ? 10 : -10))) }, true);
            }
            else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                event.preventDefault();
                event.stopPropagation();
                patchElement(element.id, { height: Math.max(24, Math.min(HEIGHT - element.y, element.height + (event.key === 'ArrowDown' ? 10 : -10))) }, true);
            } }}/></>}
     </div>;
        })}
    </div>
   </div>
  </div>
  <div className={styles.zoom}><button type="button" aria-label="Zoom out" onClick={() => setZoom(value => Math.max(.2, value - .1))}><Minus size={15}/></button><span>{Math.round(zoom * 100)}%</span><button type="button" aria-label="Zoom in" onClick={() => setZoom(value => Math.min(2, value + .1))}><Plus size={15}/></button><button type="button" onClick={fit}>Fit</button></div>
  {!readOnly && <span className={styles.hint}>{editing ? 'Type directly on the page' : selected === '__page__' ? 'Choose a background colour or image' : current ? 'Drag to move · Double-click text to edit' : 'Click an element to edit · Add text or images above'}</span>}
 </div>;
}
