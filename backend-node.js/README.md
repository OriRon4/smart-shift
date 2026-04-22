# Smart-Shift Backend

This folder is now a backend skeleton only for the V1 rebuild.

There is intentionally no Node.js or Express implementation yet.

## Planned Structure

```text
src/
  algorithms/
  config/
  controllers/
  repositories/
  routes/
  services/
  utils/
```

## Build Intent

We will add backend code step by step based on the two current source markdown files at the repo root.

For V1, this backend exists mainly to support one schedule-generation flow and one schedule-display flow, while keeping a clean separation between:

- routes
- controllers
- services
- repositories
- scheduling algorithm logic
