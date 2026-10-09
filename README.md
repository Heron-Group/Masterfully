# Research Portal

A private, single-user web app for a practice-led PhD: a research journal and a
reading list organised into groups, with optional AI summaries.

Every journal entry, source and reading group is a plain Markdown file with YAML
frontmatter in a separate content folder, which is its own Git repository and is
pushed to a private GitHub repo. There is no database: the in-memory index is
rebuilt from the files on startup.

> **Status:** stage 1 of 6 (foundations). Full deployment instructions for Plesk
> come in stage 6.

## Development

```bash
npm install
cp .env.example .env.local   # then fill in the values (see below)
npm run dev                  # http://localhost:3000
```

Generate the password hash and a session secret with:

```bash
npm run hash-password
```

In a `.env` file each `$` in the hash must be written as `\$` (the script prints
both forms). With no `CONTENT_DIR` set, development uses `./.dev-content`, which
is created as a fresh Git repository on first run.

### Checks

```bash
npm test           # unit tests (storage, frontmatter, section rewrites)
npm run test:e2e   # browser tests (needs: npx playwright install chromium)
npm run typecheck
npm run lint
```

## How it fits together

| Path | Role |
| --- | --- |
| `lib/content/` | The only code that touches the content folder and Git. Parsing, safe section rewrites, the index, one commit per write, debounced push. |
| `lib/auth/` | Password check (bcrypt), signed 30-day session cookie, login rate limit. |
| `proxy.ts` | Redirects signed-out requests to `/login` (pages) or returns 401 (API). Pages, actions and routes re-check the session themselves. |
| `instrumentation.ts` | On server start: clone or initialise the content repo and build the index. |
| `app/` | Next.js App Router pages and route handlers. |

### Content folder

```
content/
  journal/2026/10/2026-10-09T14-32-05Z.md
  sources/brody-2025-graphic-language.md
  groups/co-design-foundations.md
  attachments/sources/…  attachments/journal/<entry id>/…
  settings.md
```

Files can be edited by hand (e.g. in Obsidian). The app picks up changes on the
next page load. It never overwrites a file whose frontmatter it can't parse, and
regenerating an AI summary rewrites only the `## AI summary` section.
