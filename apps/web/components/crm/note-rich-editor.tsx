"use client";

import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type NodeViewProps } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import Placeholder from '@tiptap/extension-placeholder';
import { Bold, ListTodo, FileText, GripVertical, ImagePlus, Italic, Link2, List, ListOrdered, Paperclip, Redo2, RemoveFormatting, Table2, Undo2, Unlink, Video, X } from 'lucide-react';
import { Button, useDesignSystem } from '@/design-system';
import { useT } from '@/lib/i18n/i18n-provider';
import { translateKnown } from '@/lib/i18n/keys';
import type { CaseAsset } from '@/lib/pre-project/content';
import { NOTE_FILE_ACCEPT, mediaIds, noteMedia, safeNoteLink, videoSource, type NoteDocument } from '@/lib/crm/note-document';
import styles from './requirement-notes.module.css';

type MediaContextValue = { assets: CaseAsset[]; assetUrl: (asset: CaseAsset, preview?: boolean) => string; writable: boolean; onDraw?: (asset: CaseAsset) => void };
const MediaContext = createContext<MediaContextValue>({ assets: [], assetUrl: () => '', writable: false });
function MediaBlock({ node, updateAttributes, deleteNode, selected }: NodeViewProps) {
  const t = useT();
  const { locale } = useDesignSystem();
  const { assets, assetUrl, writable, onDraw } = useContext(MediaContext);
  const asset = assets.find(a => a.id === node.attrs.assetId), kind = String(node.attrs.kind), caption = String(node.attrs.caption ?? '');
  let video: ReturnType<typeof videoSource> | null = null;
  if (!asset && kind === 'video' && node.attrs.url) { try { video = videoSource(String(node.attrs.url)); } catch { /* Invalid legacy URLs are never embedded. */ } }
  return <NodeViewWrapper className={styles.mediaBlock} data-selected={selected || undefined} contentEditable={false}>
    <figure>
      {asset && (kind === 'image' || kind === 'drawing') ? /* Authenticated media does not use public image optimization. */
        // eslint-disable-next-line @next/next/no-img-element
        <img src={assetUrl(asset, asset.hasPreview)} alt={caption || asset.name} loading="lazy" />
        : asset && kind === 'video' ? <video src={assetUrl(asset)} controls preload="metadata" playsInline aria-label={caption || asset.name} />
        : video?.embed ? <iframe title={caption || t('Reference video')} src={video.embed} loading="lazy" allow="fullscreen; picture-in-picture" allowFullScreen referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-presentation" />
        : video ? <video src={video.url} controls preload="metadata" playsInline aria-label={caption || t('Reference video')} />
        : asset ? <a className={styles.fileBlock} href={assetUrl(asset)} target="_blank" rel="noopener noreferrer"><FileText size={22}/><span>{asset.name}<small>{t('{size} MB · Open file', { size: new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(asset.byteSize / 1024 / 1024) })}</small></span></a>
        : <p className={styles.unavailable}>{t('This file is unavailable. Your note is still saved.')}</p>}
      {writable ? <input className={styles.caption} aria-label={t('Caption for {name}', { name: asset?.name ?? t('video') })} placeholder={t('Add a caption…')} maxLength={2000} value={caption} onChange={e => updateAttributes({ caption: e.target.value })} /> : caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
    {writable && <div className={styles.mediaActions}>{onDraw && asset?.hasPreview && <button type="button" aria-label={t('Draw on {name}', { name: asset.name })} onClick={() => onDraw(asset)}>{t('Draw')}</button>}<span data-drag-handle="" className={styles.dragHandle} title={t('Drag to move media')}><GripVertical size={15}/></span><button type="button" aria-label={t('Remove {name}', { name: asset?.name ?? t('video') })} onClick={deleteNode}><X size={14}/></button></div>}
  </NodeViewWrapper>;
}

const NoteMedia = Node.create({
  name: 'noteMedia', group: 'block', atom: true, draggable: true,
  addAttributes() { return { id: { default: null }, kind: { default: 'image' }, assetId: { default: null }, url: { default: null }, caption: { default: '' } }; },
  // Media is inserted from verified uploads or the video-link action, never pasted arbitrary HTML.
  parseHTML() { return []; },
  renderHTML({ HTMLAttributes }) { return ['figure', mergeAttributes(HTMLAttributes, { 'data-note-media': '' })]; },
  addNodeView() { return ReactNodeViewRenderer(MediaBlock); },
});

type Props = MediaContextValue & { label?: string; placeholder?: string; children?: ReactNode; disabled?: boolean; simple?: boolean; compact?: boolean; document: NoteDocument; onChange: (doc: NoteDocument) => void; onUpload?: (file: File, id: string) => Promise<CaseAsset>; onAsset: (asset: CaseAsset) => void; onBusy: (busy: boolean) => void; onError: (message: string) => void };
export function NoteRichEditor(props: Props) {
  const t = useT();
  const latest = useRef(props);
  useLayoutEffect(() => { latest.current = props; });
  const upload = useRef<(files: File[]) => void>(() => {}), fileInputId = useId();
  const chooseFile = (accept: string) => { const input = document.getElementById(fileInputId) as HTMLInputElement | null; if (input) { input.accept = accept; input.click(); } };
  const [inserting, setInserting] = useState<'link' | 'video' | null>(null), [url, setUrl] = useState('');
  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: true, autolink: true, defaultProtocol: 'https', isAllowedUri: value => { try { safeNoteLink(value); return true; } catch { return false; } } } }), Placeholder.configure({ placeholder: props.placeholder ?? t(props.simple ? 'Add the client request, site notes, or anything still to confirm…' : 'Write the client’s requirements…') }), TableKit.configure({ table: { resizable: false } }), TaskList, TaskItem.configure({nested:true}), NoteMedia],
    immediatelyRender: false, shouldRerenderOnTransaction: true,
    content: props.document.content, editable: props.writable,
    editorProps: {
      attributes: { class: styles.prose, role: 'textbox', 'aria-label': props.label ?? t(props.simple ? 'Requirement details' : 'Requirement notes'), 'aria-multiline': 'true', dir: 'auto' },
      handlePaste: (_view, event) => { const files = [...(event.clipboardData?.files ?? [])]; if (!files.length) return false; if (latest.current.writable) upload.current(files); return true; },
      handleDrop: (view, event) => { const files = [...(event.dataTransfer?.files ?? [])]; if (!files.length) return false; if (latest.current.writable) { const pos = view.posAtCoords({ left: event.clientX, top: event.clientY }); if (pos) editor?.commands.setTextSelection(pos.pos); upload.current(files); } return true; },
    },
    onUpdate: ({ editor: current }) => latest.current.onChange({ version: 1, content: current.getJSON() }),
  });
  useEffect(() => { if (editor && !editor.isDestroyed) editor.setEditable(props.writable && !props.disabled, false); }, [editor, props.writable, props.disabled]);
  useLayoutEffect(() => { upload.current = async files => {
    const current = latest.current;
    if (!editor || !current.writable || current.disabled || !current.onUpload) return;
    let count = Math.max(current.assets.length, mediaIds(editor.getJSON()).size);
    current.onBusy(true); current.onError('');
    try {
      for (const file of files) {
        if (count >= 20) throw new Error(t('Each note can have up to 20 files.'));
        if (!file.size || file.size > 20 * 1024 * 1024) throw new Error(t('{name}: choose a file up to 20 MB.', { name: file.name }));
        const asset = await current.onUpload(file, crypto.randomUUID());
        current.onAsset(asset); count++;
        editor.chain().insertContent([noteMedia(asset), { type: 'paragraph' }]).run();
      }
    } catch (error) { current.onError(error instanceof Error ? translateKnown(t, error.message) : t('Upload failed. Please try again.')); }
    finally { current.onBusy(false); }
  }; }, [editor, t]);
  const insertLink = () => {
    if (!editor) return;
    try {
      if (inserting === 'video') { const source = videoSource(url); editor.chain().focus().insertContent([{ type: 'noteMedia', attrs: { id: crypto.randomUUID(), kind: 'video', assetId: null, url: source.url, caption: '' } }, { type: 'paragraph' }]).run(); }
      else {
        const href = safeNoteLink(url);
        if (editor.state.selection.empty && !editor.isActive('link')) editor.chain().focus().insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href, target: '_blank', rel: 'noopener noreferrer' } }] }).run();
        else editor.chain().focus().extendMarkRange('link').setLink({ href, target: '_blank', rel: 'noopener noreferrer' }).run();
      }
      setInserting(null); setUrl(''); props.onError('');
    } catch (error) { props.onError(translateKnown(t, (error as Error).message)); }
  };
  const tool = (label: string, icon: ReactNode, action: () => void, active?: boolean, disabled = false) => <button key={label} type="button" title={label} aria-label={label} aria-pressed={active} disabled={!props.writable || props.disabled || !editor || disabled} onMouseDown={e => e.preventDefault()} onClick={action}>{icon}</button>;
  return <div className={styles.richEditor} data-compact={props.compact || undefined}>
    {props.writable && props.simple && <div className={styles.captureBar} role="toolbar" aria-label={t('Requirement attachments')}><span>{t('Details')}</span><span>{t('Paste or drop photos and files here')}</span><div>{tool(t('Add link'), <><Link2 size={14}/>{t('Add link')}</>, () => { setUrl(editor?.getAttributes('link').href ?? ''); setInserting('link'); }, inserting === 'link')}{props.onUpload && tool(t('Attach photos or files'), <><Paperclip size={14}/>{t('Add files')}</>, () => chooseFile(NOTE_FILE_ACCEPT))}</div><input id={fileInputId} className={styles.hidden} type="file" aria-label={t('Attach requirement files')} accept={NOTE_FILE_ACCEPT} multiple onChange={e => { const files = [...(e.target.files ?? [])]; e.target.value = ''; upload.current(files); }}/></div>}
    {props.writable && !props.simple && <div className={styles.formatBar} role="toolbar" aria-label={t('Note formatting')}>
      <select data-editor-control aria-label={t('Text style')} disabled={props.disabled} value={editor?.isActive('heading', { level: 1 }) ? 'h1' : editor?.isActive('heading', { level: 2 }) ? 'h2' : editor?.isActive('heading', { level: 3 }) ? 'h3' : 'paragraph'} onChange={e => e.target.value === 'paragraph' ? editor?.chain().focus().setParagraph().run() : editor?.chain().focus().setHeading({ level: Number(e.target.value.slice(1)) as 1 | 2 | 3 }).run()}><option value="paragraph">{t('Normal text')}</option><option value="h1">{t('Heading 1')}</option><option value="h2">{t('Heading 2')}</option><option value="h3">{t('Heading 3')}</option></select>
      <span className={styles.toolGroup}>{tool(t('Bold'), <Bold size={15}/>, () => { editor?.chain().focus().toggleBold().run(); }, editor?.isActive('bold'))}{tool(t('Italic'), <Italic size={15}/>, () => { editor?.chain().focus().toggleItalic().run(); }, editor?.isActive('italic'))}{tool(t('Bulleted list'), <List size={16}/>, () => { editor?.chain().focus().toggleBulletList().run(); }, editor?.isActive('bulletList'))}{tool(t('Checklist'), <ListTodo size={16}/>, () => { editor?.chain().focus().toggleTaskList().run(); }, editor?.isActive('taskList'))}{tool(t('Numbered list'), <ListOrdered size={16}/>, () => { editor?.chain().focus().toggleOrderedList().run(); }, editor?.isActive('orderedList'))}</span>
      <span className={styles.toolGroup}>{tool(t('Add link'), <Link2 size={15}/>, () => { setUrl(editor?.getAttributes('link').href ?? ''); setInserting('link'); }, inserting === 'link')}{editor?.isActive('link') && tool(t('Remove link'), <Unlink size={15}/>, () => { editor.chain().focus().unsetLink().run(); })}{props.onUpload && tool(t('Add image'), <ImagePlus size={16}/>, () => chooseFile('image/*'))}{tool(t('Add video link'), <Video size={16}/>, () => { setUrl(''); setInserting('video'); }, inserting === 'video')}{props.onUpload && tool(t('Attach files'), <Paperclip size={15}/>, () => chooseFile(NOTE_FILE_ACCEPT))}</span>
      <span className={styles.toolGroup}>{tool(t('Insert table'), <Table2 size={16}/>, () => { editor?.chain().focus().insertTable({rows:3,cols:3,withHeaderRow:true}).run(); })}</span><span className={styles.historyTools}>{tool(t('Clear formatting'), <RemoveFormatting size={15}/>, () => { editor?.chain().focus().unsetAllMarks().clearNodes().run(); })}{tool(t('Undo'), <Undo2 size={15}/>, () => { editor?.chain().focus().undo().run(); }, undefined, !editor?.can().undo())}{tool(t('Redo'), <Redo2 size={15}/>, () => { editor?.chain().focus().redo().run(); }, undefined, !editor?.can().redo())}</span>
      <input id={fileInputId} className={styles.hidden} type="file" aria-label={t('Attach reference files')} accept={NOTE_FILE_ACCEPT} multiple onChange={e => { const files = [...(e.target.files ?? [])]; e.target.value = ''; upload.current(files); }}/>
    </div>}
    {props.writable && editor?.isActive('table') && <div className={styles.tableTools} role="toolbar" aria-label={t('Table actions')}>{tool(t('Add row'), t('Add row'), () => { editor.chain().focus().addRowAfter().run(); })}{tool(t('Add column'), t('Add column'), () => { editor.chain().focus().addColumnAfter().run(); })}{tool(t('Delete row'), t('Delete row'), () => { editor.chain().focus().deleteRow().run(); })}{tool(t('Delete column'), t('Delete column'), () => { editor.chain().focus().deleteColumn().run(); })}{tool(t('Remove table'), t('Remove table'), () => { editor.chain().focus().deleteTable().run(); })}</div>}
    {inserting && props.writable && <div className={styles.linkEntry}><input autoFocus aria-label={t(inserting === 'video' ? 'Video URL' : 'Link URL')} value={url} onChange={e => setUrl(e.target.value)} placeholder={t(inserting === 'video' ? 'YouTube, Vimeo or direct video link…' : 'Paste a link…')} maxLength={2000} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); insertLink(); } if (e.key === 'Escape') setInserting(null); }}/><Button size="compact" variant="primary" onPress={insertLink} isDisabled={!url.trim()}>{t(inserting === 'video' ? 'Insert video' : 'Insert link')}</Button><button type="button" aria-label={t('Cancel link')} onClick={() => setInserting(null)}><X size={16}/></button></div>}
    <div className={styles.documentCanvas}>{props.children}
    <MediaContext.Provider value={{ assets: props.assets, assetUrl: props.assetUrl, writable: props.writable && !props.disabled, onDraw: props.onDraw }}><EditorContent editor={editor}/></MediaContext.Provider></div>
  </div>;
}
