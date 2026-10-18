"use client";

import { useState } from 'react';
import { Caveat } from 'next/font/google';
import { ArrowUpRight, Box, DoorOpen, FileText, Paperclip, Ruler } from 'lucide-react';
import { Button } from '@/design-system';
import { caseApi, scopeLabel, type CaseAsset, type ItemDimension, type ScopeEntry } from '@/lib/pre-project/content';
import styles from './scope-note-cards.module.css';
import { useT } from '@/lib/i18n/i18n-provider';
import { tKey, type MessageKey } from '@/lib/i18n/keys';

const handwriting = Caveat({ subsets: ['latin'], weight: ['400', '500'], display: 'swap', variable: '--font-client-note', fallback: ['Segoe Print', 'cursive'] });
const samplePrefix = 'Sample data for testing — ';
const dimensionBases: Record<string, MessageKey> = { finished_item: tKey('Finished item'), site_opening: tKey('Site opening'), fabrication: tKey('Fabrication') };

function NoteImage({ asset, workspaceId, caseId, url }: { asset: CaseAsset; workspaceId: string; caseId: string; url?:string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className={styles.unavailableImage}><FileText size={18} />{asset.name}</span>;
  // Private previews must use the authenticated same-origin endpoint.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={styles.noteImage} alt={asset.name} src={url ?? caseApi(workspaceId, caseId, `assets/${asset.id}?preview=1`)} loading="lazy" onError={() => setFailed(true)} />;
}

export function DimensionReadout({ dimensions, expanded = false, showAll = false }: { dimensions: ItemDimension[]; expanded?: boolean; showAll?:boolean }) {
  const t = useT();
  const shown = showAll?dimensions:dimensions.slice(0, expanded ? 6 : 3);
  const verified=dimensions.filter(d=>d.verification==='verified').length;
  const recheck=dimensions.filter(d=>d.verification==='recheck').length;
  return <div className={styles.dimensions} data-expanded={expanded || undefined}>
    <div className={styles.dimensionHeader}><Ruler size={13} /><span>{t('Dimensions')}</span></div>
    <div className={styles.dimensionLabels}><span>{t('Dimension')}</span><span>{t('Approx.')}</span><span>{t('Measured')}</span></div>
    <dl>{shown.map(d => <div key={d.id} className={styles.dimensionRow}>
      <dt>{d.name}{expanded && <small>{dimensionBases[d.basis] ? t(dimensionBases[d.basis]) : d.basis}</small>}{d.siteSurvey&&<small>{t(d.verification==='verified'?'Verified · Site rev {version}':d.verification==='recheck'?'Recheck needed · Site rev {version}':'Unverified · Site rev {version}',{version:d.siteSurvey.version})}</small>}</dt>
      <dd>{d.approximate == null ? '—' : <>{d.approximate} <span>{d.unit}</span></>}</dd>
      <dd>{d.measured == null ? '—' : <>{d.measured} <span>{d.unit}</span></>}</dd>
    </div>)}</dl>
    <p className={styles.dimensionHint}>{recheck?t(recheck===1?'{count} dimension needs rechecking':'{count} dimensions need rechecking',{count:recheck}):verified?t('{verified} of {total} dimensions verified',{verified,total:dimensions.length}):t(dimensions.some(d => d.measured != null) ? 'Measured values await verification' : 'Approximate only · site check pending')}{dimensions.length > shown.length ? ` · ${t('+{count} more',{count:dimensions.length - shown.length})}` : ''}</p>
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
  const t = useT();
  const [limit, setLimit] = useState(24);
  const ordered = measurements ? [...entries].sort((a, b) => Number(Boolean(b.specification?.dimensions.length)) - Number(Boolean(a.specification?.dimensions.length))) : entries;
  if (!entries.length) return <div className={styles.empty}><FileText size={22} /><strong>{emptyTitle}</strong><p>{emptyDescription}</p></div>;
  return <div className={handwriting.variable}>
    <div className={styles.board} aria-label={t(measurements ? 'Measurement cards' : 'Client note cards')}>
      {ordered.slice(0, limit).map(entry => {
        const preview = entry.assets.find(asset => asset.hasPreview);
        const dimensions = entry.specification?.dimensions ?? [];
        const materials = entry.specification?.materials ?? [];
        const isSample = entry.note.startsWith(samplePrefix);
        const note = isSample ? entry.note.slice(samplePrefix.length) : entry.note;
        const date = entry.updatedAt ? new Date(entry.updatedAt) : null;
        const dateText = date && !Number.isNaN(date.valueOf()) ? new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(date) : null;
        return <article key={entry.id} className={styles.noteCard} aria-label={entry.title}>
          <div className={styles.meta}><span>{requirementNotes ? <FileText size={12}/> : <DoorOpen size={12}/>} {requirementNotes ? entry.createdByName || t('Requirement note') : entry.roomName ?? ''}</span>{isSample ? <span className={styles.sample}>{t('Sample')}</span> : dateText && <time dateTime={entry.updatedAt}>{dateText}</time>}</div>
          <h3><button className={styles.openNote} aria-label={t('Open {title}', { title: entry.title })} onClick={() => measurements ? onSpecifications(entry, 'dimensions') : onOpen(entry)}>{entry.title}<ArrowUpRight size={14} aria-hidden="true" /></button></h3>
          {preview && <NoteImage key={preview.id} asset={preview} workspaceId={workspaceId} caseId={caseId} url={assetUrl?.(entry, preview, true)} />}
          {!measurements && note && <div className={styles.noteCopy}><span className={styles.noteCaption}>{t(requirementNotes ? 'Requirement notes' : 'Notes')}</span><p className={styles.noteText} dir="auto">{note}</p></div>}
          {dimensions.length > 0 ? <DimensionReadout dimensions={dimensions} expanded={measurements} /> : measurements && <p className={styles.noDimensions}>{t('No dimensions captured yet.')}</p>}
          {!measurements && materials.length > 0 && <p className={styles.materials}><Box size={12} />{materials.slice(0, 2).map(m => `${m.application}: ${m.productName || m.catalog?.material?.name || t('To decide')}`).join(' · ')}{materials.length > 2 && ` · ${t('+{count} more', { count: materials.length - 2 })}`}</p>}
          <div className={styles.noteFooter}>
            <div className={styles.facts}>{entry.kind === 'requirement' && <>{entry.quantity != null && <span>{entry.quantity} {entry.unit}</span>}<span className={styles.decision} data-status={entry.scopeStatus}>{scopeLabel(t, entry.scopeStatus)}</span></>}{entry.assets.length > 0 && <span><Paperclip size={12} />{t(entry.assets.length === 1 ? '{count} file' : '{count} files', { count: entry.assets.length })}</span>}{entry.referenceUrl && <span>{t('Reference link')}</span>}{entry.reviewStatus === 'clarification' && <span>{t('Needs clarification')}</span>}</div>
            {entry.kind === 'requirement' && (canSpecify?.(entry) ?? true) && <div className={styles.cardActions}><Button size="compact" variant="quiet" aria-label={canEdit && !entry.archivedAt ? t('Edit measurements for {title}', { title: entry.title }) : t('View measurements for {title}', { title: entry.title })} onPress={() => onSpecifications(entry, 'dimensions')}><Ruler size={13} />{t(measurements && !dimensions.length && canEdit && !entry.archivedAt ? 'Add measurements' : 'Measurements')}</Button>{!measurements && <Button size="compact" variant="quiet" aria-label={t('Materials and details for {title}', { title: entry.title })} onPress={() => onSpecifications(entry)}><Box size={13} />{t('Details')}</Button>}</div>}
          </div>
        </article>;
      })}
    </div>
    <div className={styles.boardFooter}><span>{t(measurements ? '{shown} of {total} items' : '{shown} of {total} notes', { shown: Math.min(limit, entries.length), total: entries.length })}</span>{entries.length > limit && <Button size="compact" onPress={() => setLimit(n => n + 24)}>{t('Show more')}</Button>}</div>
  </div>;
}
