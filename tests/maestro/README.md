# Maestro UI Regression Tests

These flows are quick device-level checks before Play Store uploads.

## Prereqs
- App is installed and logged in
- Orders screen is visible
- At least one order card is visible

## Run
```bash
maestro test tests/maestro/kanban-expand.yaml
maestro test tests/maestro/kanban-accept.yaml
maestro test tests/maestro/kanban-recall.yaml
maestro test tests/maestro/settings-viewmode.yaml
```

Notes:
- `kanban-accept.yaml` requires at least one pending, unacknowledged order so the Accept button is visible.
- `kanban-recall.yaml` requires Recall to already be visible (set Completed Archive Limit low enough).
