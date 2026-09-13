import { BriefService } from '../../pre-projects/brief.service';
import { describe, expect, it, vi } from 'vitest';
import { RequirementNotesService } from './requirement-notes.service';
import type { WorkspaceAccessService } from '../../workspaces/workspace-access.service';
import type { CrmEventsService } from '../shared/crm-events.service';
import type { BrandAssetStorageService } from '../../workspaces/brand-asset-storage.service';
import type { RequestActor } from '../../auth/actor';

describe('Requirement note save retries', () => {
  it('recognizes the same document after JSONB reorders object keys', async () => {
    const stored = { id: 'note', version: 2, title: 'Kitchen', note: 'Deep drawers', pinned: true, archived: false, assetIds: [], links: [], document: { content: { content: [{ content: [{ text: 'Deep drawers', type: 'text' }], type: 'paragraph' }], type: 'doc' }, version: 1 } };
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith('SELECT l.id')) return { rowCount: 1, rows: [{ enquiryId: 'enquiry' }] };
      if (sql.includes('pre_project_cases')) return { rowCount: 0, rows: [] };
      if (sql.includes("question_key IN ('requirements'")) return { rowCount: 1, rows: [{ question_key: 'requirement_notes', value: [stored] }] };
      throw new Error(`Unexpected write or query: ${sql}`);
    });
    const access = { withPermissions: (_a: unknown, _w: unknown, _p: unknown, run: (client: unknown, user: unknown) => unknown) => run({ query }, { userId: 'user' }), hasPermission: async () => true };
    const events = { record: vi.fn() };
    const service = new RequirementNotesService(access as unknown as WorkspaceAccessService, events as unknown as CrmEventsService, {} as BrandAssetStorageService, {} as BriefService);
    const result = await service.run({} as RequestActor, 'workspace', { leadId: 'lead' }, { id: 'note', version: 1, title: 'Kitchen', note: 'Deep drawers', pinned: true, archived: false, assetIds: [], links: [], document: { version: 1, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Deep drawers' }] }] } } });
    expect(result.items[0].version).toBe(2);
    expect(events.record).not.toHaveBeenCalled();
    expect(query.mock.calls.some(([sql]) => /INSERT|UPDATE/.test(sql.replace('FOR UPDATE OF l', '')))).toBe(false);
  });
});
