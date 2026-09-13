"use client";

import { useState } from 'react';
import { Caveat } from 'next/font/google';
import { ArrowUpRight, Box, DoorOpen, FileText, Paperclip, Ruler } from 'lucide-react';
import { Button } from '@/design-system';
import { caseApi, scopeLabels, type CaseAsset, type ItemDimension, type ScopeEntry } from '@/lib/pre-project/content';
import styles from './scope-note-cards.module.css';

const handwriting = Caveat({ subsets: ['latin'], weight: ['400', '500'], display: 'swap', variable: '--font-client-note', fallback: ['Segoe Print', 'cursive'] });
const samplePrefix = 'Sample data for testing — ';
const dimensionBases: Record<string, string> = { finished_item: 'Finished item', site_opening: 'Site opening', fabrication: 'Fabrication' };

function NoteImage({ asset, workspaceId, caseId, url }: { asset: CaseAsset; workspaceId: string; caseId: string; url?:string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className={styles.unavailableImage}><FileText size={18} />{asset.name}</span>;
  // Private previews must use the authenticated same-origin endpoint.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={styles.noteImage} alt={asset.name} src={url ?? caseApi(workspaceId, caseId, `assets/${asset.id}?preview=1`)} loading="lazy" onError={() => setFailed(true)} />;
}

export function DimensionReadout({ dimensions, expanded = false, showAll = false }: { dimensions: ItemDimension[]; expanded?: boolean; showAll?:boolean }) {
  const shown = showAll?dimensions:dimensions.slice(0, expanded ? 6 : 3);
  const verified=dimensions.filter(d=>d.verification==='verified').length;
  const recheck=dimensions.filter(d=>d.verification==='recheck').length;
  return <div className={styles.dimensions}>
    <div className={styles.dimensionHeader}><Ruler size={13} /><span>Dimensions</span></div>
    <div className={styles.dimensionLabels}><span>Dimension</span><span>Approx.</span><span>Measured</span></div>
    <dl>{shown.map(d => <div key={d.id} className={styles.dimensionRow}>
      <dt>{d.name}{expanded && <small>{dimensionBases[d.basis] ?? d.basis}</small>}{d.siteSurvey&&<small>{d.verification==='verified'?'Verified':d.verification==='recheck'?'Recheck needed':'Unverified'} · Site rev {d.siteSurvey.version}</small>}</dt>
      <dd>{d.approximate == null ? '—' : <>{d.approximate} <span>{d.unit}</span></>}</dd>
      <dd>{d.measured == null ? '—' : <>{d.measured} <span>{d.unit}</span></>}</dd>
    </div>)}</dl>
    <p className={styles.dimensionHint}>{recheck?`${recheck} dimension${recheck===1?' needs':'s need'} rechecking`:verified?`${verified} of ${dimensions.length} dimensions verified`:dimensions.some(d => d.measured != null) ? 'Measured values await verification' : 'Approximate only · site check pending'}{dimensions.length > shown.length ? ` · +${dimensions.length - shown.length} more` : ''}</p>
  </div>;
}

type Props = {
  entries: ScopeEntry[];
  workspaceId: string;
  caseId: string;
  locale: string;
  measurements?: boolean;
  requirementNotes?: boolean;
  assetUrl?: (entry: ScopeEntry, asset: CaseAsset, preview?: boolean) => string;
  canEdit: boolean;
  canSpecify?: (entry: ScopeEntry) => boolean;
  emptyTitle: string;
  emptyDescription: string;
  onOpen: (entry: ScopeEntry) => void;
  onSpecifications: (entry: ScopeEntry, focus?: 'dimensions') => void;
};

export function ScopeNoteCards({ entries, workspaceId, caseId, locale, measurements = false, requirementNotes = false, assetUrl, canEdit, canSpecify, emptyTitle, emptyDescription, onOpen, onSpecifications }: Props) {
  const [limit, setLimit] = useState(24);
  const ordered = measurements ? [...entries].sort((a, b) => Number(Boolean(b.specification?.dimensions.length)) - Number(Boolean(a.specification?.dimensions.length))) : entries;
  if (!entries.length) return <div className={styles.empty}><FileText size={22} /><strong>{emptyTitle}</strong><p>{emptyDescription}</p></div>;
  return <div className={handwriting.variable}>
    <div className={styles.board} aria-label={measurements ? 'Measurement cards' : 'Client note cards'}>
      {ordered.slice(0, limit).map(entry => {
        const preview = entry.assets.find(asset => asset.hasPreview);
        const dimensions = entry.specification?.dimensions ?? [];
        const materials = entry.specification?.materials ?? [];
        const isSample = entry.note.startsWith(samplePrefix);
        const note = isSample ? entry.note.slice(samplePrefix.length) : entry.note;
        const date = entry.updatedAt ? new Date(entry.updatedAt) : null;
        const dateText = date && !Number.isNaN(date.valueOf()) ? new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(date) : null;
        return <article key={entry.id} className={styles.noteCard} aria-label={entry.title}>
          <div className={styles.meta}><span>{requirementNotes ? <FileText size={12}/> : <DoorOpen size={12}/>} {requirementNotes ? entry.createdByName || 'Requirement note' : entry.roomName ?? 'Whole project'}</span>{isSample ? <span className={styles.sample}>Sample</span> : dateText && <time dateTime={entry.updatedAt}>{dateText}</time>}</div>
          <h3><button className={styles.openNote} aria-label={`Open ${entry.title}`} onClick={() => measurements ? onSpecifications(entry, 'dimensions') : onOpen(entry)}>{entry.title}<ArrowUpRight size={14} aria-hidden="true" /></button></h3>
          {preview && <NoteImage key={preview.id} asset={preview} workspaceId={workspaceId} caseId={caseId} url={assetUrl?.(entry, preview, true)} />}
          {!measurements && note && <div className={styles.noteCopy}><span className={styles.noteCaption}>{requirementNotes ? 'Requirement notes' : 'Notes'}</span><p className={styles.noteText} dir="auto">{note}</p></div>}
          {dimensions.length > 0 ? <DimensionReadout dimensions={dimensions} expanded={measurements} /> : measurements && <p className={styles.noDimensions}>No dimensions captured yet.</p>}
          {!measurements && materials.length > 0 && <p className={styles.materials}><Box size={12} />{materials.slice(0, 2).map(m => `${m.application}: ${m.productName || m.catalog?.material?.name || 'To decide'}`).join(' · ')}{materials.length > 2 && ` · +${materials.length - 2} more`}</p>}
          <div className={styles.noteFooter}>
            <div className={styles.facts}>{entry.kind === 'requirement' && <>{entry.quantity != null && <span>{entry.quantity} {entry.unit}</span>}<span className={styles.decision} data-status={entry.scopeStatus}>{scopeLabels[entry.scopeStatus]}</span></>}{entry.assets.length > 0 && <span><Paperclip size={12} />{entry.assets.length} {entry.assets.length === 1 ? 'file' : 'files'}</span>}{entry.referenceUrl && <span>Reference link</span>}{entry.reviewStatus === 'clarification' && <span>Needs clarification</span>}</div>
            {entry.kind === 'requirement' && (canSpecify?.(entry) ?? true) && <div className={styles.cardActions}><Button size="compact" variant="quiet" aria-label={`${canEdit && !entry.archivedAt ? 'Edit' : 'View'} measurements for ${entry.title}`} onPress={() => onSpecifications(entry, 'dimensions')}><Ruler size={13} />{measurements && !dimensions.length && canEdit && !entry.archivedAt ? 'Add measurements' : 'Measurements'}</Button>{!measurements && <Button size="compact" variant="quiet" aria-label={`Materials and details for ${entry.title}`} onPress={() => onSpecifications(entry)}><Box size={13} />Details</Button>}</div>}
          </div>
        </article>;
      })}
    </div>
    <div className={styles.boardFooter}><span>{Math.min(limit, entries.length)} of {entries.length} {measurements ? 'items' : 'notes'}</span>{entries.length > limit && <Button size="compact" onPress={() => setLimit(n => n + 24)}>Show more</Button>}</div>
  </div>;
}
