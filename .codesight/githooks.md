# Git Hooks

> **Note for agents:** These hooks fire automatically on git operations and will block the operation if they fail.

## `commit-msg` — lefthook

- **commitlint**: `pnpm exec commitlint --edit {1}`

## `pre-push` — lefthook

- **ci-checks**: `mise run pre-push`

_Source: lefthook.yml_
