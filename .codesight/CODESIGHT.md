# @victor-software-house/pi-multicodex — AI Context Map

> **Stack:** raw-http | none | unknown | typescript

> 0 routes | 0 models | 0 components | 14 lib files | 0 env vars | 4 middleware | 0% test coverage
> **Token savings:** this file is ~1,400 tokens. Without it, AI exploration would cost ~11,300 tokens. **Saves ~9,900 tokens per conversation.**
> **Last scanned:** 2026-05-18 08:37 — re-run after significant changes

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
- `provider.ts`
  - function getOpenAICodexMirror: () => void
  - function buildMulticodexProviderConfig: (accountManager) => void
  - interface ProviderModelDef
  - const PROVIDER_ID
- `quota.ts` — function isQuotaErrorMessage: (message) => boolean
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
  - function isManagedModel: (model) => boolean
  - function formatActiveAccountStatus: (ctx, accountEmail, usage, preferences) => string
  - function createUsageStatusController: (accountManager) => void
  - interface FooterPreferences
  - _...3 more_
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

- `account-manager.ts` — imported by **10** files
- `usage.ts` — imported by **5** files
- `storage.ts` — imported by **4** files
- `auth.ts` — imported by **3** files
- `status.ts` — imported by **3** files
- `stream-wrapper.ts` — imported by **3** files
- `commands.ts` — imported by **2** files
- `extension.ts` — imported by **2** files
- `hooks.ts` — imported by **2** files
- `provider.ts` — imported by **2** files
- `quota.ts` — imported by **2** files
- `selection.ts` — imported by **1** files
- `usage-client.ts` — imported by **1** files
- `browser.ts` — imported by **1** files
- `abort-utils.ts` — imported by **1** files

## Import Map (who imports what)

- `account-manager.ts` ← `account-manager.test.ts`, `commands.test.ts`, `commands.ts`, `extension.ts`, `hooks.ts` +5 more
- `usage.ts` ← `account-manager.ts`, `commands.ts`, `index.ts`, `status.ts`, `usage-client.ts`
- `storage.ts` ← `commands.ts`, `index.ts`, `scripts/generate-schema.ts`, `selection.ts`
- `auth.ts` ← `account-manager.ts`, `auth.test.ts`, `index.ts`
- `status.ts` ← `commands.test.ts`, `commands.ts`, `extension.ts`
- `stream-wrapper.ts` ← `index.test.ts`, `index.ts`, `provider.ts`
- `commands.ts` ← `commands.test.ts`, `extension.ts`
- `extension.ts` ← `extension.test.ts`, `index.ts`
- `hooks.ts` ← `extension.ts`, `hooks.test.ts`
- `provider.ts` ← `extension.ts`, `status.ts`

---

# Test Coverage

> **0%** of routes and models are covered by tests
> 8 test files found

---

_Generated by [codesight](https://github.com/Houseofmvps/codesight) — see your codebase clearly_