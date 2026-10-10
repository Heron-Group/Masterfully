# Research Portal

A private web app for practice-led PhD research: a **research journal** that
works like a messaging app, and a **reading list** of sources organised into
reading groups, with optional AI summaries.

Anyone can sign up with a **Google or Microsoft account**; each person gets their
own private workspace. AI summaries use each person's **own Claude or OpenAI API
key**, added in Settings.

Everything written is a plain Markdown file with YAML frontmatter, in a content
folder that is its own Git repository and is pushed to a private GitHub repo.
There is no database. You can read and edit the files without the app (in
Obsidian or any text editor), and the app picks up those edits on the next page
load.

- [Development](#development)
- [Configuration](#configuration)
- [Sign-in with Google and Microsoft](#sign-in-with-google-and-microsoft)
- [The content repository and backups](#the-content-repository-and-backups)
- [Deploying on Plesk](#deploying-on-plesk)
- [Docker fallback](#docker-fallback)
- [AI summaries and changing the model](#ai-summaries-and-changing-the-model)
- [Tests](#tests)
- [How the code fits together](#how-the-code-fits-together)
- [Troubleshooting](#troubleshooting)

---

## Development

Requires Node.js 20.9 or later (22 or 24 recommended) and `git`.

```bash
npm install
npm run session-secret       # prints a SESSION_SECRET
cp .env.example .env.local   # paste it in (see below)
npm run dev                  # http://localhost:3000
```

For local work you need `SESSION_SECRET`, `OWNER_EMAIL` and either Google or
Microsoft credentials (with `http://localhost:3000/api/auth/<google|microsoft>/callback`
as a redirect URI) or the development sign-in:

```bash
CONTENT_DIR=.dev-content   # the default in development; created on first run
AI_FAKE=1                  # scripted AI summaries, no API key or cost (development only)
AUTH_DEV_LOGIN=1           # development only, see below
```

With `AUTH_DEV_LOGIN=1`, open
`http://localhost:3000/api/auth/dev?email=you@example.com` to sign in as that
address without Google or Microsoft (for trying several users, and for the
browser tests). It isn't shown on the login page and never works in production.

To fill the development content folder with sample journal entries, sources and
a reading group:

```bash
npm run seed-dev
```

---

## Configuration

All settings are environment variables. `.env.example` lists them with comments.

| Variable | Required | Purpose |
| --- | --- | --- |
| `SESSION_SECRET` | yes | At least 32 random characters. Signs session cookies and encrypts users' AI keys. Changing it signs everyone out, and users must re-enter their AI keys. |
| `APP_URL` | yes (production) | Public address, e.g. `https://research.example.com`, for sign-in redirects. |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | for Google sign-in | OAuth client (see [below](#sign-in-with-google-and-microsoft)). The button only shows when both are set. |
| `AUTH_MICROSOFT_ID`, `AUTH_MICROSOFT_SECRET` | for Microsoft sign-in | App registration (see below). |
| `AUTH_MICROSOFT_TENANT` | no | `common` (default: work, school and personal accounts), `consumers`, `organizations`, or one tenant ID. |
| `OWNER_EMAIL` | recommended | Your email. When you first sign in with Google or Microsoft using this (verified) address, the content from the single-user version moves into your workspace. |
| `CONTENT_DIR` | yes (production) | **Absolute** path of the content folder, outside the web root, e.g. `/var/www/vhosts/example.com/research-content`. |
| `CONTENT_GIT_REMOTE` | recommended | SSH URL of the private GitHub repo, e.g. `git@github.com:you/research-content.git`. Leave empty to keep content local only. |
| `CONTENT_GIT_BRANCH` | no | Default `main`. |
| `GIT_SSH_KEY_PATH` | with a remote | Private key of the GitHub deploy key (see below). |
| `GIT_PUSH_DELAY_SECONDS` | no | Push this long after the last change. Default `60`. |
| `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL` | no | Name and email on content commits. |
| `CACHE_DIR` | no | Image thumbnails (safe to delete; rebuilt on demand). Use an absolute path outside the content folder. |
| `SECRETS_DIR` | yes (production) | Users' encrypted AI API keys. Absolute path outside the content folder and web root. Default `.secrets`. |

---

## Sign-in with Google and Microsoft

Anyone with a Google or Microsoft account can sign up; the first sign-in
creates their account and an empty private workspace. A Google and a Microsoft
sign-in with the same **verified** email address join the same account. (Work
and school Microsoft accounts don't count as verified, so they are never joined
to someone else's account by email.)

**Google** (console.cloud.google.com):

1. Create a project, then **APIs & Services → OAuth consent screen**: External,
   app name, your email. Scopes: `openid`, `email`, `profile`. Publish the app
   so that anyone can sign in (these scopes need no verification).
2. **Credentials → Create credentials → OAuth client ID** → Web application.
   Authorised redirect URI: `https://research.example.com/api/auth/google/callback`
   (and `http://localhost:3000/api/auth/google/callback` for development).
3. Set `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`.

**Microsoft** (entra.microsoft.com):

1. **App registrations → New registration**. Supported account types: "Accounts
   in any organizational directory and personal Microsoft accounts". Redirect
   URI: platform **Web**, `https://research.example.com/api/auth/microsoft/callback`.
2. **Certificates & secrets → New client secret**. Copy the *value*.
   Secrets expire (up to 24 months): set a reminder to renew it.
3. Set `AUTH_MICROSOFT_ID` (the Application (client) ID) and
   `AUTH_MICROSOFT_SECRET`.

Restart the app after changing these. **Privacy:** each user only ever sees
their own workspace in the app, but whoever runs the server or can read the
GitHub repository can read everyone's files. Tell your users this.

## The content repository and backups

```
research-content/
  accounts/<user id>.md                       one file per account (name, email, sign-ins)
  users/<user id>/                            each user's private workspace:
    journal/2026/10/2026-10-09T14-32-05Z.md     one file per entry
    sources/brody-2025-graphic-language.md      one file per source
    groups/co-design-foundations.md             one file per reading group
    attachments/sources/<source id>.pdf
    attachments/journal/<entry id>/<files>
    settings.md                                 their research context
```

Content from the single-user version (at the top of the repository) moves into
the owner's workspace (`OWNER_EMAIL`) the first time they sign in, in one commit.
Commits are authored as the user who made the change. AI keys are **not** in
the repository; they are encrypted in `SECRETS_DIR`.

How the app treats it:

- **One commit per change**, with a readable message such as
  `journal: add entry 2026-10-09 15:32` or `source: update notes brody-2025-graphic-language`.
- **Push about 60 seconds after the last change.** The header shows the status
  (backed up, pending, or failed with the error) and has a **Sync now** button.
- Before each push it **pulls with rebase**, so edits you pushed from another
  computer are picked up. If they conflict with changes on the server, it stops,
  leaves every file as it was, and lists the conflicting files. Nothing is
  overwritten.
- Files edited directly on the server are committed on the next sync or restart.
- The in-memory index is only a cache. Restarting the app rebuilds it from the
  files.
- The app never rewrites a file whose frontmatter it can't parse. It shows the
  problem and asks you to fix it in a text editor.

### Setting up the GitHub repository (once)

1. On GitHub, create a **private**, empty repository, e.g. `research-content`.
2. On the server, over SSH, create a deploy key for that repository only:

   ```bash
   mkdir -p ~/.ssh && chmod 700 ~/.ssh
   ssh-keygen -t ed25519 -N "" -C "research-portal" -f ~/.ssh/research_content_deploy
   cat ~/.ssh/research_content_deploy.pub
   ```

3. In the GitHub repo, open **Settings → Deploy keys → Add deploy key**, paste
   the public key, and tick **Allow write access**.
4. Set `CONTENT_GIT_REMOTE=git@github.com:you/research-content.git` and
   `GIT_SSH_KEY_PATH=/var/www/vhosts/example.com/.ssh/research_content_deploy`
   (use the real home directory: `echo ~` shows it).

On first start, if `CONTENT_DIR` is empty or missing, the app clones the GitHub
repo into it (or starts a new repository if the GitHub one is empty). If it
already has files, it uses them as they are.

### Restoring from the backup

The GitHub repo *is* the backup, with full history. To read it without the app,
clone it anywhere (`git clone git@github.com:you/research-content.git`) and open
the folder in Obsidian or a text editor.

- **Move to a new server, or recover a lost folder.** Stop the app, make sure
  `CONTENT_DIR` points at an empty or missing folder, and start the app. It
  clones the repo.
- **Undo a change.** In a clone, find the commit (`git log -- sources/<id>.md`),
  run `git revert <commit>` or check out an old version of the file, commit and
  push. On the server, press **Sync now** to pull it in.
- **Corrupted or confusing server copy.** Stop the app, rename the folder
  (`mv research-content research-content.old`), start the app to get a fresh
  clone, then delete the old folder once you're happy.

Image thumbnails live in `CACHE_DIR` and are not backed up. They are rebuilt
from the originals when needed.

---

## Deploying on Plesk

These steps assume a subdomain such as `research.example.com`, Plesk's
**Node.js** extension and SSH access. Replace `example.com` and paths with yours.

### 1. Subdomain and HTTPS

1. **Websites & Domains → Add Subdomain**: `research.example.com`.
2. **SSL/TLS Certificates → Install** a free Let's Encrypt certificate for it,
   and turn on **Redirect from HTTP to HTTPS**.

### 2. Code

Deploy this (code) repository into the subdomain's folder, e.g.
`/var/www/vhosts/example.com/research.example.com/app`, either with Plesk's
**Git** extension or over SSH with `git clone`.

### 3. Node.js settings

**Websites & Domains → research.example.com → Node.js**, then **Enable Node.js**:

| Setting | Value |
| --- | --- |
| Node.js version | 22.x or 24.x (20.9 or later) |
| Package manager | npm |
| Document root | `/research.example.com/app/public` |
| Application mode | `production` |
| Application root | `/research.example.com/app` |
| Application startup file | `server.js` |

Under **Custom environment variables**, add the variables from
[Configuration](#configuration). Use absolute paths for
`CONTENT_DIR`, `CACHE_DIR` and `GIT_SSH_KEY_PATH`, outside the subdomain's web
root.

### 4. Build

Over SSH, in the application root, with Plesk's Node on the path:

```bash
export PATH=/opt/plesk/node/22/bin:$PATH   # match the version chosen above
npm ci --include=dev                        # dev packages are needed to build
npm run build
```

Then press **Restart App** in the Node.js panel. (`npm run build` also copies
static files into `.next/standalone`; `server.js` starts that build.)

### 5. Web server directives

**Websites & Domains → research.example.com → Apache & nginx Settings →
Additional nginx directives**:

```nginx
# Uploads: PDFs and attachments up to 50 MB each.
client_max_body_size 60m;

# Keep one app process running so the push queue isn't stopped while idle.
passenger_min_instances 1;
```

The app is designed for a single process. It still behaves correctly if
Passenger starts more than one, because Git work is serialised with a file lock
and every read checks the files for changes. If Passenger stops the app before a
pending push runs, the push happens when it next starts.

### 6. Updating

```bash
cd /var/www/vhosts/example.com/research.example.com/app
git pull
npm ci --include=dev && npm run build
```

Then **Restart App**. Your content is untouched: it lives in `CONTENT_DIR`, not
in the code folder.

### 7. Check it

- Open `https://research.example.com`. You should see the sign-in page with
  the Google and Microsoft buttons.
- Sign in, post a journal entry, and within about a minute it appears in the
  GitHub repo. The header dot turns green ("Backed up").
- Signed out, `https://research.example.com/api/journal` returns 401.

---

## Docker fallback

For Plesk's Docker extension or any container host. The image includes `git` and
`ssh`; content and caches live in the `/data` volume.

```bash
docker build -t research-portal .
docker run -d --name research -p 3000:3000 \
  -v research-data:/data \
  -v ~/.ssh/research_content_deploy:/keys/deploy:ro \
  -e GIT_SSH_KEY_PATH=/keys/deploy \
  --env-file .env.production \
  research-portal
```

`CONTENT_DIR` (`/data/content`), `CACHE_DIR` (`/data/cache`) and `SECRETS_DIR`
(`/data/secrets`) are set in the image. Put HTTPS in front of it (Plesk's Docker proxy rules, or any reverse
proxy) and allow request bodies of at least 60 MB.

---

## AI summaries and changing the model

Summaries are generated only when you press the button. They stream into the
page and are saved to the file's `## AI summary` section, with the date and
model in an HTML comment. Your `## Notes` and `## Overview` are never touched,
and a failed call changes nothing.

- **Source summaries** read the attached PDF. A PDF over about 22 MB or 590
  pages is summarised in parts from its extracted text and then combined; the
  page says when this happens. Without a PDF, the app reads the linked web page.
  If the page can't be read (paywall, login), it says so and offers to summarise
  from the details and your notes only.
- **Group summaries** use each source's details, your notes, the group note and
  the source's AI summary, not the full PDFs. They are marked **out of date**
  when sources are added, removed or re-summarised.
- Your **research context** (Settings) is included in every prompt.

**Each user brings their own key.** In **Settings → AI summaries**, choose
Claude or OpenAI and paste an API key. It is checked with the provider (a free
request), encrypted with AES-256-GCM under a key derived from `SESSION_SECRET`,
and stored in `SECRETS_DIR`; only a hint (`sk-ant-…a1b2`) is ever shown again.
Calls are billed to that user's account. Without a key, the summary buttons
explain what to do.

**Change the model** in the same place. Defaults: `claude-opus-5-5` for Claude
(`claude-sonnet-5-5` costs about half as much per token) and `gpt-5.5` for
OpenAI. On Claude models that support it, the app turns on Anthropic's
server-side refusal fallback, so a request declined by one model's safety
filters is retried on another.

**Edit the prompts** in [lib/ai/prompts.ts](lib/ai/prompts.ts).

---

## Tests

```bash
npm test             # unit tests: storage, workspaces, accounts, frontmatter, Git sync, auth, key encryption, AI flow
npm run typecheck
npm run lint
npm run test:e2e     # browser tests against the dev server
```

Browser tests need the browsers once (`npx playwright install chromium webkit`),
the sample content (`npm run seed-dev`), and `AI_FAKE=1`, `AUTH_DEV_LOGIN=1`,
and `OWNER_EMAIL` in `.env.local`. They sign in with the development sign-in,
as the owner and as other users. They
run on desktop Chrome, a mobile viewport, and WebKit (Safari's engine). They
check, among other things:

- the journal opens at the newest entry with no scroll movement;
- older entries load without moving the view;
- a 40 MB PDF uploads, is served and is committed;
- a pasted screenshot and a PDF attach to one entry;
- regenerating a summary changes only the `## AI summary` section;
- nothing is reachable signed out;
- one user can't see or open another's sources;
- an AI key is saved encrypted, shown only as a hint, and can be replaced or removed.

To run them against a production build, start it on another port and point
the tests at it, e.g. `E2E_PORT=3200 E2E_CONTENT_DIR=/path/to/content npx playwright test`.

---

## How the code fits together

| Path | Role |
| --- | --- |
| [lib/content/](lib/content/) | **The only code that touches the content folder and Git**: tolerant parsing, safe section rewrites, the index, one commit per write with rollback, debounced push with rebase and conflict stop. Moving to another backend later (e.g. the GitHub API) is contained here. |
| [lib/auth/](lib/auth/) | Google and Microsoft sign-in (OAuth with PKCE), the only way to sign in or sign up, and a signed 30-day HTTP-only cookie holding the user id. |
| [lib/accounts.ts](lib/accounts.ts) | Accounts (`accounts/<id>.md`), linking sign-ins by verified email, and moving single-user content into the owner's workspace. |
| [proxy.ts](proxy.ts) | Redirects signed-out requests. Pages, server actions and API routes also check the session themselves. Upload routes skip the proxy (it would cut large bodies off at 10 MB). |
| [lib/ai/](lib/ai/) | Prompts, PDF handling, safe URL fetching, streaming summaries from Claude or OpenAI, and each user's encrypted key ([user-config.ts](lib/ai/user-config.ts)). |
| [app/](app/) | Pages (journal, library, groups, settings) and API routes. |
| [instrumentation.ts](instrumentation.ts) | On start: clone or open the content repo. Each workspace's index is built on its user's first request. |
| [server.js](server.js) | Startup file for Plesk and `npm start`. |

Structured to make later additions straightforward: citation export (sources
keep raw metadata), tags (extra frontmatter fields survive edits), full-text
journal search (the index already holds every entry), linking entries to
sources (IDs are stable filenames).

---

## Troubleshooting

**"Backup failed" with a conflict.** Something changed the same file on GitHub
and on the server. Over SSH: `cd $CONTENT_DIR && git status`, then
`git pull --rebase`, fix the listed files, `git add` them and
`git rebase --continue`. Then press **Sync now**.

**"Backup failed" with a permission or host-key error.** Check the deploy key
has write access and `GIT_SSH_KEY_PATH` is right. Test with
`GIT_SSH_COMMAND="ssh -i $GIT_SSH_KEY_PATH" git -C $CONTENT_DIR push`.

**Uploads fail with "too large".** Add `client_max_body_size 60m;` to the
nginx directives (step 5). The app's own limit is 50 MB per file.

**A file shows "frontmatter can't be read".** The YAML between the `---` lines
has an error (often an unquoted colon in a title). Fix it in a text editor; it
reappears on the next page load.

**Signed out on every device.** Expected after changing `SESSION_SECRET`. Users
also need to re-enter their AI keys (Settings says so).

**"Sign-in didn't work" after Google or Microsoft.** Check the redirect URI in
the provider's console matches `APP_URL` exactly, and that the client secret
hasn't expired. The server log has the provider's error.

**Thumbnails missing.** Delete `CACHE_DIR`; they are regenerated. HEIC photos
are converted to JPEG on upload.
