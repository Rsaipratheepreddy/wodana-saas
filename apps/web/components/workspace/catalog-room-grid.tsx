"use client";

import { useMemo } from 'react';
import { ArrowUpRight, LayoutGrid, Pencil } from 'lucide-react';
import { Button, EmptyState } from '@/design-system';
import type { CatalogRecord } from '@/lib/workspace/catalog';
import { catalogAttribute, catalogHierarchy, catalogRecordName } from '@/lib/workspace/catalog-hierarchy';
import styles from './catalog-room-grid.module.css';

function roomTone(id: string) {
  let hash = 0;
  for (const character of id) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
  return ['lilac', 'rose', 'peach'][hash % 3];
}

export function CatalogRoomGrid({ rooms, items, canManage, filtered, onOpen, onEdit, onDetails }: {
  rooms: CatalogRecord[]; items: CatalogRecord[]; canManage: boolean; filtered: boolean;
  onOpen: (room: CatalogRecord) => void; onEdit: (room: CatalogRecord) => void; onDetails: (room: CatalogRecord) => void;
}) {
  const graph = useMemo(() => catalogHierarchy(items), [items]);
  if (!rooms.length) return <EmptyState icon={<LayoutGrid size={24}/>} title={filtered ? 'No rooms found' : 'Create your first room'} description={filtered ? 'Try another search or change the filters.' : 'Add a room, then build its collection of items, variants and materials.'}/>;
  return <div className={styles.grid} role="list" aria-label="Room grid">
    {rooms.map(room => {
      const related = [...new Map(graph.related('work', 'room', room.id).map(item => [item.id, item])).values()];
      const variantCount = new Set(related.flatMap(item => graph.related('variant', 'work', item.id).map(variant => variant.id))).size;
      const preview = related.slice(0, 3).map(catalogRecordName).join(' · ');
      const category = catalogAttribute(room, 'category');
      const description = room.description || catalogAttribute(room, 'description');
      const detail = [room.archived ? 'Archived' : category, description || preview || 'Ready for your first item'].filter(Boolean).join(' · ');
      return <article role="listitem" aria-label={room.name} key={room.id} className={styles.card} data-tone={roomTone(room.id)} data-archived={room.archived || undefined}>
        <header className={styles.header}>
          <h2><button className={styles.open} type="button" onClick={() => onOpen(room)} aria-label={`Open ${room.name}`}>{room.name}</button></h2>
          <ArrowUpRight size={15} aria-hidden="true"/>
        </header>
        <p className={styles.detail} title={detail}>{detail}</p>
        <footer className={styles.footer}>
          <div className={styles.counts}><span><strong>{related.length}</strong> {related.length === 1 ? 'item' : 'items'}</span>{variantCount > 0 && <span>{variantCount} {variantCount === 1 ? 'variant' : 'variants'}</span>}</div>
          {canManage && !room.archived ? <Button size="compact" variant="quiet" aria-label={`Edit ${room.name}`} onPress={() => onEdit(room)}><Pencil size={13}/>Edit</Button> : room.archived ? <Button size="compact" variant="quiet" aria-label={`Details for ${room.name}`} onPress={() => onDetails(room)}>Details</Button> : null}
        </footer>
      </article>;
    })}
  </div>;
}
