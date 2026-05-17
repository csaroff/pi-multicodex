# Per-account status line widgets plan

## Goal

Add status line widgets that show usage, reset timing, and percent left for managed MultiCodex accounts, similar to `pi-codex-usage`, while preserving the existing active-account widget.

## Constraints

- Keep the existing `multicodex-usage` widget unchanged.
- Publish new account-list widgets under separate stable IDs so users can lay them out independently:
  - `multicodex-account-usage-0`
  - `multicodex-account-usage-1`
- Limit account-list widgets to two managed MultiCodex accounts.
- Ignore the ephemeral pi auth account entirely for these new widgets.
- Reuse existing usage/reset formatting preferences where practical.
- Always clear the new widget slots when their contents are no longer valid; stale per-account widgets are worse than temporarily missing widgets.

## Account selection

For the new account-list widgets:

1. Start from `accountManager.getAccounts()` so selection uses the same account view as the rest of the extension.
2. Filter out any account where `accountManager.isPiAuthAccount(account)` is true.
3. Put the current display/active managed account first when it is managed.
4. Fill remaining slots from the remaining managed accounts in storage order.
5. Render at most two accounts.

Examples:

| Managed accounts | Pi auth present | Active account | New widgets |
| --- | --- | --- | --- |
| A, B | no | A | A, B |
| A, B, C | no | B | B, A |
| A, B | yes | pi auth | A, B |
| none | yes | pi auth | none |

## Rendering

- Keep the existing active-account widget on `multicodex-usage` exactly as-is.
- Render per-account widgets on fixed slot IDs, not email-derived IDs.
- Use compact output that includes an account label plus usage windows, for example:

  ```text
  a@example.com 5h:75% left ↺1h2m · 7d:40% left ↺3d4h
  b@example.com 5h:12% left ↺20m · 7d:68% left ↺5d
  ```

- Reuse existing preferences where reasonable:
  - `usageMode`
  - `resetWindow`
  - `showReset`
- Always show both 5h and 7d usage percentages. `resetWindow` controls only which reset countdowns are included, matching the current footer semantics.
- Always include an account label for these multi-account widgets, even if the existing footer preference has `showAccount=false`, so two widgets cannot become indistinguishable.

## Refresh behavior

Add a second status update path inside `createUsageStatusController`, alongside the current active-account footer logic, so it shares the same preferences, context checks, refresh scheduling, and session-switch behavior:

1. Compute the two managed accounts to display.
2. Render cached usage immediately when available.
3. Refresh usage only for the displayed managed accounts.
4. Update each slot after refresh.
5. Use independent refresh handling, such as `Promise.allSettled`, so one account cannot prevent the other from updating.
6. Treat thrown refresh errors and `undefined` refresh results as no-update for that account.
7. Keep the cached slot content when refresh fails or returns no usage.
8. Never fetch or render pi auth usage in these new widgets.

Protect against stale async updates overwriting newer account selections by using a generation/race guard around refresh work. This matters after model switches, account removals, active-account changes, and session switches.

## Cleanup

Clear unused per-account slots on every render:

```ts
ctx.ui.setStatus("multicodex-account-usage-0", undefined);
ctx.ui.setStatus("multicodex-account-usage-1", undefined);
```

Expected cleanup behavior:

- Zero managed accounts: clear both slots.
- One managed account: render slot 0 and clear slot 1.
- Two managed accounts: render both slots.
- Non-Codex or non-managed model/context: clear both slots.
- Missing UI/statusline API: clear both slots when possible and otherwise do nothing.
- `stopAutoRefresh`: clear both slots.
- Session switch or context change: clear both slots before rendering the new context's managed accounts.

This cleanup path must not clear or modify `multicodex-usage`.

## Tests

Add coverage in `status.test.ts` for:

- New widgets use IDs separate from `multicodex-usage`.
- Pi auth account is filtered out.
- At most two managed accounts are rendered.
- Active/display managed account is ordered first.
- Active pi auth account does not occupy a slot.
- Slot 1 is cleared when going from two managed accounts to one.
- Both slots are cleared when no managed accounts exist.
- Both slots are cleared for non-Codex or non-managed model/context.
- Both slots are cleared by `stopAutoRefresh`.
- Cached data renders before refresh.
- Only displayed managed accounts are refreshed.
- One refresh failure or `undefined` result keeps that account's cached widget intact and leaves the other widget free to update.
- Stale refresh results cannot overwrite newer slot contents.

## Acceptance criteria

Implementation is complete when all of the following are true:

- The existing active-account status widget still uses `multicodex-usage` and keeps its current behavior.
- The new per-account widgets are published only under:
  - `multicodex-account-usage-0`
  - `multicodex-account-usage-1`
- The new widgets never use email-derived or account-derived status IDs.
- The new widgets render at most two accounts.
- The new widgets never render or refresh the pi auth account.
- If the active/display account is a managed account, it appears in slot 0.
- If the active/display account is pi auth or unavailable, slot order falls back to managed-account storage order.
- Each rendered per-account widget includes an account label.
- Each rendered per-account widget shows both 5h and 7d usage percentages.
- `resetWindow` controls only reset countdown visibility for the new widgets, not which usage percentages appear.
- Refreshing one account can fail without clearing its cached slot or blocking the other displayed account from updating.
- Unused or invalid slots are cleared in every invalid state listed in the cleanup section.
- The new cleanup path never clears or mutates `multicodex-usage`.
- README documents the new widget IDs and their managed-only, max-two behavior.

## Verification

Verify the implementation without relying on user-provided manual testing:

### Automated verification

1. Run focused unit tests for `status.ts` behavior:

   ```bash
   npm run test -- status.test.ts
   ```

2. Run the full repository checks:

   ```bash
   npm run lint
   npm run tsgo
   npm run test
   ```

3. Run package validation:

   ```bash
   npm pack --dry-run
   ```

4. Inspect the resulting diff and confirm:

   - no changes touch `.codesight/` manually
   - no account email is used as a status widget ID
   - all new status IDs are the fixed IDs listed above
   - all per-account widget updates go through the same controller lifecycle as the existing usage widget
   - `multicodex-usage` remains independently controlled
   - the README matches the implemented behavior

5. If tests require mocks, ensure the mocks prove these cases rather than only snapshotting strings:

   - managed-only account filtering
   - slot ordering
   - slot clearing
   - cache-before-refresh behavior
   - failed/undefined refresh preservation
   - stale refresh guard

### Runtime/integration verification

Automated tests are the primary correctness check. If the local pi extension development workflow allows it, also perform a runtime smoke test that exercises the real extension wiring:

1. Link or load the local `pi-multicodex` extension into pi using the repository's normal development workflow.
2. Provide two or more managed test accounts through the extension's normal storage path, plus a pi auth account when possible.
3. Launch pi on an `openai-codex` model so the extension owns the provider/status path.
4. Trigger the status refresh path by session start, session switch, account selection, or another existing refresh hook.
5. Confirm pi receives three independent status widget IDs when applicable:

   - existing active-account widget: `multicodex-usage`
   - new managed-account slot: `multicodex-account-usage-0`
   - new managed-account slot: `multicodex-account-usage-1`

6. Confirm the pi auth account is absent from the two new slots.
7. Confirm hiding/removing managed accounts or switching to a non-managed context clears the two new slots.

If direct TUI inspection is not practical, use a small local harness that loads the controller with a fake `ctx.ui.setStatus` implementation and real-ish account-manager state. The harness should verify emitted widget IDs and slot contents end-to-end, while unit tests continue to cover edge cases in detail.

## Documentation updates

Update README footer/status documentation to mention:

- The existing active-account widget remains `multicodex-usage`.
- The new per-account widgets are separate layout targets:
  - `multicodex-account-usage-0`
  - `multicodex-account-usage-1`
- Only managed MultiCodex accounts are shown.
- The pi auth account is ignored.
- A maximum of two account widgets are rendered.
