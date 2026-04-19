# Smart-Shift Backend

This folder contains the modular Node.js and Express backend for Smart-Shift.

## Structure

```text
src/
  config/
  controllers/
  routes/
  services/
  utils/
```

## Entry Point

- Main server file: `src/server.js`

## Current Scheduling API

- `POST /generate-schedule` expects a JSON body with `weekStartDate`
- schedule generation filters to active waiters only
- generation runs on one normalized Monday-to-Sunday week at a time

## Legacy Note

The original root-level `index.js` remains in the repo as a compatibility entry file.
