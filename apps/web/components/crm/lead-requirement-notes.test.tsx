import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RequirementNotes } from './requirement-notes';
import { LeadRequirementNoteForm } from './lead-requirement-notes';
import { plainNoteDraft, requirementNoteLinks, textDocument, type RequirementNote } from '@/lib/crm/note-document';

vi.mock('next/font/google', () => ({ Caveat: () => ({ variable: 'note-font' }) }));
afterEach(() => vi.unstubAllGlobals());
const note: RequirementNote = { id: 'note-one', title: 'Kitchen storage and utility requirements', note: 'Deep drawers', version: 2, archived: false };
const asset = { id: 'photo', name: 'Kitchen.png', mimeType: 'image/png', byteSize: 240, hasPreview: true };
function setup(items: RequirementNote[] = [note], canEdit = true) {
  let current = structuredClone(items);
  const saves: RequirementNote[] = [];
  const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
    if (init.method === 'PUT') {
      const input = JSON.parse(String(init.body)); saves.push(input);
      current = [{ ...input, version: input.version + 1 }, ...current.filter(item => item.id !== input.id)];
    }
    return { ok: true, json: async () => ({ items: current, canEdit }) };
  });
  vi.stubGlobal('fetch', fetcher);
  render(<RequirementNotes workspaceId="workspace" leadId="lead" />);
  return { saves, fetcher, user: userEvent.setup() };
}

describe('Lead requirement cards', () => {
  it('shows requirement cards and opens a plain form with the full title', async () => {
    const { user, saves } = setup();
    expect(await screen.findByRole('article', { name: note.title })).toBeVisible();
    expect(screen.queryByRole('textbox', { name: 'Requirement notes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: `Open ${note.title}` }));
    const dialog = screen.getByRole('dialog', { name: 'Requirement note' });
    expect(within(dialog).getByRole('textbox', { name: 'Title' })).toHaveValue(note.title);
    const body = within(dialog).getByRole('textbox', { name: 'Requirement notes' });
    expect(body.tagName).toBe('TEXTAREA');
    expect(body).toHaveValue('Deep drawers');
    fireEvent.change(body, { target: { value: 'Deep drawers\nAdd a pantry' } });
    await user.click(within(dialog).getByRole('button', { name: 'Save note' }));
    await screen.findByText('Requirement note saved.');
    expect(saves[0]).toMatchObject({ id: 'note-one', version: 2, title: note.title, note: 'Deep drawers\nAdd a pantry', document: textDocument('Deep drawers\nAdd a pantry') });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('adds a note, searches cards and protects unsaved changes when closing', async () => {
    const { user, saves } = setup();
    await screen.findByRole('article');
    await user.click(screen.getByRole('button', { name: 'Add note' }));
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Bedroom');
    await user.type(screen.getByRole('textbox', { name: 'Requirement notes' }), 'Quiet palette');
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(await screen.findByRole('dialog', { name: 'Discard unsaved changes?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    await user.click(screen.getByRole('button', { name: 'Save note' }));
    await screen.findByText('Requirement note saved.');
    expect(saves[0]).toMatchObject({ version: 0, title: 'Bedroom', note: 'Quiet palette' });
    await user.type(screen.getByRole('searchbox', { name: 'Search notes' }), 'Quiet');
    expect(screen.getByRole('article', { name: 'Bedroom' })).toBeVisible();
    expect(screen.queryByRole('article', { name: note.title })).not.toBeInTheDocument();
  });

  it('archives and restores without deleting the original content', async () => {
    const { user, saves } = setup();
    await user.click(await screen.findByRole('button', { name: `Open ${note.title}` }));
    await user.click(screen.getByRole('button', { name: 'Archive note' }));
    await screen.findByText('Note archived.');
    expect(saves[0]).toMatchObject({ id: note.id, archived: true, note: note.note });
    await user.click(screen.getByRole('button', { name: `Open ${note.title}` }));
    expect(screen.getByRole('textbox', { name: 'Requirement notes' })).toHaveAttribute('readonly');
    await user.click(screen.getByRole('button', { name: 'Restore note' }));
    await screen.findByText('Note restored.');
    expect(saves[1]).toMatchObject({ id: note.id, version: 3, archived: false, note: note.note });
  });

  it('retains the edited draft on save failure and respects read-only access', async () => {
    const { user, fetcher } = setup();
    await user.click(await screen.findByRole('button', { name: `Open ${note.title}` }));
    await user.type(screen.getByRole('textbox', { name: 'Title' }), ' revised');
    fetcher.mockRejectedValueOnce(new Error('This note changed. Your draft is kept.'));
    await user.click(screen.getByRole('button', { name: 'Save note' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your draft is kept.');
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue(`${note.title} revised`);
  });

  it('opens files and references read-only with no editing actions', async () => {
    const { user } = setup([{ ...note, assets: [asset], links: ['https://example.com/'] }], false);
    await user.click(await screen.findByRole('button', { name: `Open ${note.title}` }));
    expect(screen.getByRole('textbox', { name: 'Requirement notes' })).toHaveAttribute('readonly');
    expect(screen.getByRole('link', { name: 'Download Kitchen.png' })).toHaveAttribute('href', '/api/workspace/requirement-notes/lead/lead/note-one/assets/photo?workspaceId=workspace');
    expect(screen.getByRole('link', { name: 'https://example.com/' })).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.queryByRole('button', { name: 'Save note' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add note' })).not.toBeInTheDocument();
  });

  it('keeps successful file uploads when another upload fails', async () => {
    const user = userEvent.setup();
    const save = vi.fn().mockResolvedValue(undefined);
    const upload = vi.fn().mockResolvedValueOnce(asset).mockRejectedValueOnce(new Error('Upload failed'));
    render(<LeadRequirementNoteForm note={note} workspaceId="workspace" leadId="lead" canEdit onSave={save} onClose={vi.fn()} onUpload={upload} assetUrl={() => '/private/image'}/>);
    await user.upload(screen.getByLabelText('Attach reference files'), [new File(['png'], 'Kitchen.png', { type: 'image/png' }), new File(['pdf'], 'Plan.pdf', { type: 'application/pdf' })]);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Upload failed'));
    expect(screen.getByRole('link', { name: 'Download Kitchen.png' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save note' }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ assets: [asset] }));
  });
});

describe('existing document preservation', () => {
  const rich: RequirementNote = { ...note, document: { version: 1, content: { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Deep drawers', marks: [{ type: 'bold' }, { type: 'link', attrs: { href: 'https://example.com/reference' } }] }] },
    { type: 'noteMedia', attrs: { id: 'block', kind: 'image', assetId: 'photo', caption: '' } },
  ] } }, assets: [asset] };
  it('keeps rich formatting on title-only edits and keeps files and hidden link destinations on text edits', () => {
    const draft = { ...rich, title: 'New title', links: requirementNoteLinks(rich) };
    expect(plainNoteDraft(rich, draft).document).toEqual(rich.document);
    const edited = plainNoteDraft(rich, { ...draft, note: 'New requirements' });
    expect(edited).toMatchObject({ note: 'New requirements', assets: [asset], links: ['https://example.com/reference'], document: textDocument('New requirements') });
  });
  it('removes only explicitly detached media and links from the document', () => {
    const saved = plainNoteDraft(rich, { ...rich, assets: [], links: [] });
    expect(saved.document?.content.content).toEqual([{ type: 'paragraph', content: [{ type: 'text', text: 'Deep drawers', marks: [{ type: 'bold' }] }] }]);
    expect(rich.document?.content.content).toHaveLength(2);
  });
});
