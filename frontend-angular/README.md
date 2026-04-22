# Smart-Shift Frontend

This folder is now a frontend skeleton only for the V1 rebuild.

There is intentionally no Angular implementation yet.

## Planned Structure

```text
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
```

## V1 UI Intent

The first frontend build should stay simple:

- one weekly schedule board
- one week selector
- one generate action
- clear assigned and requested counts per shift
- all V1 frontend files should stay under the `schedule` feature
