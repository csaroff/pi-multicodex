# MultiCodex and pi-codex-conversion coexistence plan

## Problem

MultiCodex account rotation can fail when `pi-codex-conversion` is installed because both extensions override the same Codex provider slot:

- provider: `openai-codex`
- API: `openai-codex-responses`

Pi stores one active provider implementation per API. The last registration for `openai-codex-responses` wins. Without deliberate composition, either:

- `pi-codex-conversion` bypasses MultiCodex, so quota rotation never runs, or
- MultiCodex bypasses `pi-codex-conversion`, so conversion behavior is lost.

Package order is not a reliable fix because Pi queues provider registrations during extension load before flushing them into the global registry.

## Success criteria

- MultiCodex remains the final provider wrapper for `openai-codex-responses`.
- The wrapped delegate can be either Pi's built-in Codex provider or `pi-codex-conversion`.
- `pi-codex-conversion` still receives the selected Codex account token through `options.apiKey`.
- Quota errors before meaningful output rotate to another available account.
- Quota errors after meaningful output do not retry and risk duplicating partial output/tool activity.
- Exhausted accounts are persisted as unavailable even when usage refresh fails.
- The `/multicodex` command surface does not change.

## Source findings from `IgorWarzocha/pi-codex-conversion`

### Provider registration collision

`pi-codex-conversion` unconditionally registers `openai-codex` with API `openai-codex-responses` in `src/providers/openai-codex-custom-provider.ts`.

This collides with MultiCodex's provider registration because Pi has a single active provider per API.

### Auth injection is compatible

`pi-codex-conversion` resolves its Codex token from `options.apiKey` before falling back to environment auth.

MultiCodex already injects the selected account token this way:

- `options.apiKey = selectedAccountToken`
- `model.headers["X-Multicodex-Account"] = account.email`

Therefore the correct composition direction is:

```text
Pi model registry -> MultiCodex wrapper -> pi-codex-conversion delegate -> Codex API
```

Do not make `pi-codex-conversion` wrap MultiCodex. Conversion does not select or rotate accounts.

### Pre-content stream markers are emitted

`pi-codex-conversion` can emit structural stream events before any visible text/thinking delta, including:

- `text_start`
- `thinking_start`

These are not meaningful output. MultiCodex must still be allowed to rotate accounts after these events if a quota error occurs.

### Quota errors are preserved but may be flattened

`pi-codex-conversion` turns Codex 429/quota responses into friendly messages such as:

```text
You have hit your ChatGPT usage limit (...)
```

The message is still classifiable as quota, but reset metadata can be harder to recover after formatting. MultiCodex should parse reset information from every available source before falling back to usage refresh.

### WebSocket fallback stops after stream start

`pi-codex-conversion` retries/falls back before stream events start. After stream events have been emitted, it throws errors upward.

MultiCodex's retry boundary must therefore be based on meaningful output, not merely on whether any stream event was observed.

## Implementation plan

### 1. Add explicit provider wrapping state

In `provider.ts`, track the provider MultiCodex registers and the delegate it wraps:

```ts
let activeMulticodexProvider: ApiProviderRef | undefined;
let activeDelegateProvider: ApiProviderRef | undefined;
```

Add a helper that returns the provider MultiCodex should wrap:

1. Read `getApiProvider("openai-codex-responses")`.
2. If the current provider is `activeMulticodexProvider`, return `activeDelegateProvider`.
3. Otherwise, return the current provider.
4. Throw a clear error if no provider exists.

This prevents recursive self-wrapping when MultiCodex re-registers itself on later sessions.

### 2. Install MultiCodex as a late wrapper

Move provider wrapping out of one-time eager registration and into an idempotent installer, for example:

```ts
installMulticodexProviderWrapper(accountManager)
```

The installer should:

1. Resolve the current delegate with the helper above.
2. Build a MultiCodex provider config using `createStreamWrapper(accountManager, delegate)`.
3. Register `openai-codex` with API `openai-codex-responses`.
4. Store both the registered wrapper and delegate in module state.

Call this installer:

- during initial extension setup, to preserve current behavior when no other extension collides, and
- during `session_start` after Pi has flushed queued provider registrations, so MultiCodex becomes the final wrapper around any later provider override such as `pi-codex-conversion`.

If Pi supports `session_switch` or equivalent active-session refresh hooks, call the installer there too. The operation must be idempotent.

### 3. Preserve delegate inputs exactly

`stream-wrapper.ts` should keep passing the selected account token through `options.apiKey`.

When calling the delegate provider:

- clone the original model and options rather than mutating them
- preserve all existing option fields
- replace only `apiKey` and the linked `signal`
- add `X-Multicodex-Account` without dropping existing headers

This preserves `pi-codex-conversion` behavior and keeps account selection visible in diagnostics.

### 4. Define retryable pre-output events

Replace the current `forwardedNonStartEvent` guard with a clearer state machine:

```text
pre-output -> output-started -> terminal
```

Pre-output events are protocol/structure only and may be buffered:

- `start`
- `text_start`
- `thinking_start`
- `toolcall_start`

Meaningful output events end the retry window:

- `text_delta`
- `thinking_delta`
- `toolcall_delta`
- `toolcall_end`
- any unknown non-terminal event not explicitly classified as pre-output

On quota before meaningful output:

1. Do not flush buffered pre-output events.
2. Mark the current account exhausted.
3. Abort the delegate stream.
4. Select another account.
5. Start a fresh delegate stream.

On non-quota error or quota after meaningful output:

1. Flush buffered pre-output events.
2. Forward the error to Pi.
3. End the stream.

Treat unknown stream events conservatively as meaningful output unless explicitly known to be safe protocol markers.

### 5. Persist exhaustion from the original quota failure

Extend quota handling so the original quota error can mark the account exhausted even if usage refresh fails.

Parse reset metadata from, in priority order:

1. structured error object fields, if present
2. embedded JSON in error messages such as `Codex error: {...}`
3. response headers inside embedded JSON
4. friendly text such as `Try again in ~225 min`
5. fallback default exhaustion window

Recognized reset fields:

- `resets_at`
- `resets_in_seconds`
- `X-Codex-Primary-Reset-At`
- `X-Codex-Primary-Reset-After-Seconds`

Use the primary reset window for account rotation. Secondary/week reset data can remain informational unless existing rotation settings say otherwise.

If exact reset metadata cannot be recovered, persist a conservative short exhaustion window rather than making the account immediately selectable again.

### 6. Keep manual-account behavior explicit

When a manually selected account hits quota before meaningful output:

1. mark it exhausted
2. clear the manual selection
3. exclude it from the current retry loop
4. rotate to the best available non-exhausted account

When a manually selected account fails auth refresh:

1. preserve the existing auth-failure skip behavior
2. clear manual selection
3. continue to another account if available

This matches current behavior while making quota rotation predictable.

## Implementation order

1. Add provider-wrapper state and idempotent wrapper installer in `provider.ts`.
2. Call the installer from extension setup and session lifecycle hooks.
3. Add focused tests for provider composition and self-wrap prevention.
4. Replace pre-output retry tracking in `stream-wrapper.ts`.
5. Add focused tests for quota after `text_start` / `thinking_start`.
6. Add quota reset extraction and persistence support.
7. Add tests for reset extraction from friendly messages and embedded Codex JSON.
8. Run the normal checks: `npm run lint`, `npm run tsgo`, `npm run test`.

## Test plan

### Provider composition

- MultiCodex wraps Pi's built-in Codex provider when no conversion extension exists.
- MultiCodex wraps `pi-codex-conversion` when conversion is registered before MultiCodex.
- MultiCodex still wraps `pi-codex-conversion` when conversion registers after MultiCodex but before `session_start` wrapper installation.
- Re-running the wrapper installer does not wrap MultiCodex around itself.
- The wrapped delegate receives the selected account token through `options.apiKey`.

### Stream retry behavior

- Quota after only `start` rotates.
- Quota after `text_start` but before `text_delta` rotates.
- Quota after `thinking_start` but before `thinking_delta` rotates.
- Quota after meaningful `text_delta` does not rotate.
- Quota after meaningful `thinking_delta` does not rotate.
- Non-quota errors flush buffered pre-output events and are forwarded.
- Unknown non-terminal events are treated as meaningful output and block rotation.

### Account exhaustion

- Friendly quota errors from `pi-codex-conversion` are classified as quota.
- Embedded Codex JSON quota errors are classified as quota.
- `X-Codex-Primary-Reset-At` persists `quotaExhaustedUntil`.
- `X-Codex-Primary-Reset-After-Seconds` persists `quotaExhaustedUntil`.
- `resets_at` persists `quotaExhaustedUntil`.
- `resets_in_seconds` persists `quotaExhaustedUntil`.
- Missing reset metadata persists a conservative fallback exhaustion window.
- All accounts exhausted produces one clear error and does not loop endlessly.

### Manual selection

- Manual account quota before meaningful output clears manual selection and rotates.
- Manual account auth failure clears manual selection and rotates when another account is available.

## Non-goals

- Do not change `/multicodex` command names or add parallel command aliases.
- Do not require users to reorder packages.
- Do not modify `pi-codex-conversion`.
- Do not implement broader provider middleware in Pi core as part of this fix.
- Do not change rotation policy beyond the minimum needed for reliable quota handling.

## Rollout and verification

1. Verify behavior with only MultiCodex installed.
2. Verify behavior with MultiCodex and `pi-codex-conversion` installed.
3. Verify a forced quota error before meaningful output rotates accounts.
4. Verify a quota error after meaningful output surfaces normally.
5. Confirm `~/.pi/agent/codex-accounts.json` records exhausted accounts with `quotaExhaustedUntil`.
6. Confirm existing README-documented commands still work.

## Risks and mitigations

- **Risk:** session lifecycle hook is too late for the first request.
  - **Mitigation:** keep initial registration and add a test or manual validation that `session_start` runs before model streaming.
- **Risk:** future stream event types are misclassified.
  - **Mitigation:** treat unknown events as meaningful output, not retryable protocol markers.
- **Risk:** reset metadata parsing is brittle.
  - **Mitigation:** parse multiple known shapes and fall back to a conservative exhaustion window.
- **Risk:** re-registering the provider repeatedly creates recursion.
  - **Mitigation:** track wrapper/delegate identity and test idempotent installation.
