# @victor-software-house/pi-multicodex — AI Context Map

> **Stack:** raw-http | none | unknown | typescript

> 0 routes | 0 models | 0 components | 15 lib files | 1 env vars | 4 middleware | 0% test coverage
> **Token savings:** this file is ~1,800 tokens. Without it, AI exploration would cost ~12,500 tokens. **Saves ~10,700 tokens per conversation.**
> **Last scanned:** 2026-08-02 23:58 — re-run after significant changes

---

# Libraries

- `account-manager.ts` — class AccountManager
- `auth.ts`
  - function parseImportedOpenAICodexAuth: (auth, unknown>) => ImportedOpenAICodexAuth | undefined
  - function loadImportedOpenAICodexAuth: () => Promise<
  - interface ImportedOpenAICodexAuth
- `browser.ts` — function openLoginInBrowser: (pi, ctx, url) => Promise<void>
- `commands.ts` — function registerCommands: (pi, accountManager, statusController) => void
- `hooks.ts` — function handleSessionStart: (accountManager, warningHandler?) => void, function handleNewSessionSwitch: (accountManager, warningHandler?) => void
- `oauth-client.ts` — function loginOAuthToken: (interaction) => Promise<OAuthCredentials>, function refreshOAuthToken: (refreshToken) => Promise<OAuthCredentials>
- `provider.ts`
  - function getOpenAICodexMirror: () => void
  - function buildMulticodexProviderConfig: (accountManager, baseProvider) => void
  - function installMulticodexProviderWrapper: (pi, accountManager) => void
  - function resetMulticodexProviderWrapperForTest: () => void
  - interface ProviderModelDef
  - const PROVIDER_ID
- `quota.ts` — function isQuotaErrorMessage: (message) => boolean, function extractQuotaResetAt: (quotaError, now) => void
- `scripts/generate-synthetic-screenshots.py`
  - function load_font: (size) -> ImageFont.FreeTypeFont
  - function text_width: (draw, text, font) -> int
  - function create_canvas: (width, height) -> tuple[Image.Image, ImageDraw.ImageDraw]
  - function draw_segmented_text: (draw, x, y, font, segments, tuple[int, int, int]]]) -> None
  - function draw_colored_footer: (draw, x, y, font, account_label, five_hour_usage, seven_day_usage) -> None
  - function save_image: (image, filename) -> None
  - _...3 more_
- `selection.ts` — function isAccountAvailable: (account, now) => boolean, function pickBestAccount: (accounts, usageByEmail, CodexUsageSnapshot>, options?) => Account | undefined
- `status.ts`
  - function loadFooterPreferences: () => Promise<FooterPreferences>
  - function persistFooterPreferences: (preferences) => Promise<void>
  - function formatUsageSummaryText: (usage, mode) => string
  - function isManagedModel: (model) => boolean
  - function formatActiveAccountStatus: (ctx, accountEmail, usage, preferences) => string
  - function createUsageStatusController: (accountManager) => void
  - _...4 more_
- `storage.ts`
  - function loadStorage: () => StorageData
  - function saveStorage: (data) => void
  - type Account
  - type StorageData
  - const StorageSchema
  - const STORAGE_FILE
- `stream-wrapper.ts` — function setCloseCodexWebSocketSessionsForTest: (handler) => void, function createStreamWrapper: (accountManager, baseProvider) => void
- `usage-client.ts` — function fetchCodexUsage: (accessToken, accountId, options?) => Promise<CodexUsageSnapshot>
- `usage.ts`
  - function parseCodexUsageResponse: (data) => Omit<CodexUsageSnapshot, "fetchedAt">
  - function isUsageUntouched: (usage?) => boolean
  - function getNextResetAt: (usage?) => number | undefined
  - function getMaxUsedPercent: (usage?) => number | undefined
  - function getWeeklyResetAt: (usage?) => number | undefined
  - function formatResetAt: (resetAt?) => string
  - _...1 more_

---

# Config

## Environment Variables

- `PI_CODING_AGENT_DIR` **required** — index.test.ts

## Config Files

- `tsconfig.json`

## Key Dependencies

- zod: ^4.3.6

---

# Middleware

## auth
- auth.test — `auth.test.ts`
- auth — `auth.ts`

## validation
- generate-schema — `scripts/generate-schema.ts`

## custom
- generate-synthetic-screenshots — `scripts/generate-synthetic-screenshots.py`

---

# Dependency Graph

## Most Imported Files (change these carefully)

- `account-manager.ts` — imported by **11** files
- `oauth-client.ts` — imported by **6** files
- `usage.ts` — imported by **5** files
- `storage.ts` — imported by **4** files
- `auth.ts` — imported by **3** files
- `quota.ts` — imported by **3** files
- `stream-wrapper.ts` — imported by **3** files
- `browser.ts` — imported by **2** files
- `commands.ts` — imported by **2** files
- `status.ts` — imported by **2** files
- `extension.ts` — imported by **2** files
- `hooks.ts` — imported by **2** files
- `provider.ts` — imported by **2** files
- `selection.ts` — imported by **1** files
- `usage-client.ts` — imported by **1** files
- `abort-utils.ts` — imported by **1** files

## Import Map (who imports what)

- `account-manager.ts` ← `account-manager.test.ts`, `commands.test.ts`, `commands.ts`, `extension.ts`, `hooks.ts` +6 more
- `oauth-client.ts` ← `account-manager.test.ts`, `account-manager.ts`, `commands.test.ts`, `commands.ts`, `oauth-client.test.ts` +1 more
- `usage.ts` ← `account-manager.ts`, `commands.ts`, `index.ts`, `status.ts`, `usage-client.ts`
- `storage.ts` ← `commands.ts`, `index.ts`, `scripts/generate-schema.ts`, `selection.ts`
- `auth.ts` ← `account-manager.ts`, `auth.test.ts`, `index.ts`
- `quota.ts` ← `account-manager.ts`, `index.ts`, `stream-wrapper.ts`
- `stream-wrapper.ts` ← `index.test.ts`, `index.ts`, `provider.ts`
- `browser.ts` ← `commands.test.ts`, `commands.ts`
- `commands.ts` ← `commands.test.ts`, `extension.ts`
- `status.ts` ← `commands.test.ts`, `extension.ts`

---

# Test Coverage

> **0%** of routes and models are covered by tests
> 10 test files found

---

# CI/CD Pipelines

## GitHub Actions (2 workflows)

| Workflow | Triggers | Jobs | Deploy | Environments |
|---|---|---|---|---|
| CI | push, pull_request | 1 | — | — |
| Release | push, workflow_dispatch | 1 | — | — |

### Secrets

- `GITHUB_TOKEN`

---
_Source: .github/workflows/ci.yml, .github/workflows/publish.yml_
_Generated by codesight-cicd-plugin_

---

# Git Hooks

> **Note for agents:** These hooks fire automatically on git operations and will block the operation if they fail.

## `commit-msg` — lefthook

- **commitlint**: `pnpm exec commitlint --edit {1}`

## `pre-push` — lefthook

- **ci-checks**: `mise run pre-push`

_Source: lefthook.yml_

---

_Generated by [codesight](https://github.com/Houseofmvps/codesight) — see your codebase clearly_