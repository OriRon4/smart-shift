# Smart-Shift

Smart-Shift is currently a structure-only V1 workspace.

There is intentionally no implementation code in the repository right now. We are building the project step by step from the two markdown files currently in the repo.

## Current Source Of Truth

- [SmartShift_Codex_Master_Prompt_V1 (1).md](C:/Users/Ori/Documents/GitHub/smart-shift/SmartShift_Codex_Master_Prompt_V1%20(1).md)
- [SmartShift_Codex_Working_Method_Prompt (2).md](C:/Users/Ori/Documents/GitHub/smart-shift/SmartShift_Codex_Working_Method_Prompt%20(2).md)

These two files now define both:
- the Smart-Shift V1 product direction
- how we implement it together, step by step

## Structure

```text
backend-node.js/
  src/
    algorithms/
    config/
    controllers/
    repositories/
    routes/
    services/
    utils/
frontend-angular/
  src/
    app/
      features/
        schedule/
          components/
            schedule-grid/
            week-selector/
          models/
          pages/
            schedule-board/
          services/
    assets/
db-mysql/
  schema/
  seed/
```

## Working Rules

- No backend code yet
- No frontend code yet
- No SQL implementation yet
- Only folders, docs, and placeholders until we build each piece together
- The frontend structure is centered on the single V1 `schedule` feature
- The backend stays ready for routing, service, repository, and algorithm layers around schedule generation
