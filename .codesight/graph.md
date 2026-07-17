# Dependency Graph

## Most Imported Files (change these carefully)

- `account-manager.ts` — imported by **11** files
- `oauth-client.ts` — imported by **5** files
- `usage.ts` — imported by **5** files
- `storage.ts` — imported by **4** files
- `auth.ts` — imported by **3** files
- `quota.ts` — imported by **3** files
- `stream-wrapper.ts` — imported by **3** files
- `commands.ts` — imported by **2** files
- `status.ts` — imported by **2** files
- `extension.ts` — imported by **2** files
- `hooks.ts` — imported by **2** files
- `provider.ts` — imported by **2** files
- `selection.ts` — imported by **1** files
- `usage-client.ts` — imported by **1** files
- `browser.ts` — imported by **1** files
- `abort-utils.ts` — imported by **1** files

## Import Map (who imports what)

- `account-manager.ts` ← `account-manager.test.ts`, `commands.test.ts`, `commands.ts`, `extension.ts`, `hooks.ts` +6 more
- `oauth-client.ts` ← `account-manager.test.ts`, `account-manager.ts`, `commands.ts`, `oauth-client.test.ts`, `refresh-race.test.ts`
- `usage.ts` ← `account-manager.ts`, `commands.ts`, `index.ts`, `status.ts`, `usage-client.ts`
- `storage.ts` ← `commands.ts`, `index.ts`, `scripts/generate-schema.ts`, `selection.ts`
- `auth.ts` ← `account-manager.ts`, `auth.test.ts`, `index.ts`
- `quota.ts` ← `account-manager.ts`, `index.ts`, `stream-wrapper.ts`
- `stream-wrapper.ts` ← `index.test.ts`, `index.ts`, `provider.ts`
- `commands.ts` ← `commands.test.ts`, `extension.ts`
- `status.ts` ← `commands.test.ts`, `extension.ts`
- `extension.ts` ← `extension.test.ts`, `index.ts`
