# Requirements notebook — 8 September 2026

Pre-execution Requirements now opens a searchable notebook: notes on the left, a Tiptap editor on the right. The same lead-linked records remain available in CRM. Scope records and their measurements remain accessible in Scope items; inspiration and layouts retain their existing sections.

The editor supports headings, paragraphs, lists, emphasis, links, undo/redo, inline images, PDFs, MP4/WebM uploads, and YouTube/Vimeo or direct video links. Media has captions and can be moved within the document. Pin, archive and restore persist with the note. Save state is explicit; drafts survive switching notes and failed saves. Uploaded files remain private and video downloads support byte ranges. Uploads remain limited to 20 MB each and 20 files per note.

## Content and compatibility

- Optional `document: { version: 1, content: ... }` and `pinned` fields extend existing note JSON; no SQL migration is required.
- The backend validates node nesting, formatting, links, size and media ownership. A stable UUID identifies each media block; authenticated asset IDs are stored instead of temporary URLs. Drawing blocks can already reference an uploaded image without altering surrounding text. Native mobile capture/drawing UI is intentionally deferred.
- The server derives the plain `note` text from the document for search and AI. Notes support up to 60,000 characters. Existing plain notes, attachments and reference links load without a write or automatic migration.
- Optimistic versions and idempotent retries remain in place. Legacy clients cannot replace a rich note with conflicting plain text. Archived/released notes retain read-only restrictions.
- Quotation analysis now loads active shared notes as well as legacy scope notes. It uses their text and authenticated image/PDF references, excludes archived notes, and refuses to generate a partial plan if the notes endpoint fails. Existing analysis file limits apply; videos and external URLs are reported as not analyzed.

## Validation

- 33 web tests cover the notebook, retained scope access and AI context/coverage.
- 14 backend tests cover document validation, media ownership, future drawing blocks, unsupported input, video container detection, byte ranges and retrying JSONB documents.
- Web/core builds, web type checking and targeted lint pass.
- Local browser checks exercise real upload/save/reload, formatted text and lists, inline links, image captions, video playback/seeking, stale saves, draft retention, search, archive/restore, light/dark accessibility, RTL and 1024/768/390 px layouts.
- Staged and live verification use transactional backend writes that roll back and isolated browser write previews, leaving production notes unchanged.

## Release

- Release: `20260908-requirement-notebook`.
- Web build: `LmaT7XJD3soyOVC0yAp1y`.
- Web/core ports: 13170/18130.
- Previous release `20260908-iglo-testing-sessions` remains available for rollback.
- The existing explicit Iglo account exception and authentication policy are preserved.
- Pre-release backup: `/var/backups/wodana/current/release-20260908T090329Z`.
- Live at `https://iglo.wodana.ai`; staged and public-site browser checks passed without browser errors. Each backend verification passed seven assertions and rolled back its temporary records.
- Post-release backup: `/var/backups/wodana/current/release-20260908T091946Z`.
