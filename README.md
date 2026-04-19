# Smart-Shift

Smart-Shift is a restaurant shift scheduling system that generates weekly waiter schedules based on availability and worker strength.

## Project Structure

```text
backend-node.js/
frontend-angular/
db-mysql/
```

## Current Setup Status

- `backend-node.js` contains the modular Node.js backend
- `frontend-angular` is reserved for the Angular client
- `db-mysql` contains the database schema and seed files

## Notes

- The original root-level `index.js` is still present as a legacy entry file.
- The new backend entry point is `backend-node.js/src/server.js`.
- Schedule generation is week-based and expects `weekStartDate` in `POST /generate-schedule`.
