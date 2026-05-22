# Smart-Shift

Smart-Shift is a restaurant shift scheduling system for a Grade 14 software
engineering final project. The system includes employee management,
availability submission, schedule generation and editing, schedule validation,
publish/unpublish flow, and ML-based shift requirement recommendations.

## Stack

- Frontend: Angular
- Backend: Node.js / Express
- Database: MySQL
- Security: JWT authentication, RBAC, bcrypt password hashing
- ML: Python scripts for shift requirement recommendations

ML recommendations suggest `recommended_waiters` and
`recommended_strength_score`. They do not assign employees and do not replace
the scheduling algorithm; managers review and apply recommendations before the
heuristic scheduler uses the updated shift requirement fields.

## Project Structure

```text
backend-node.js/
  src/
    algorithms/     Schedule generation and scoring logic
    config/         Environment and database configuration
    constants/      Shared backend constants
    controllers/    Express request handlers
    middleware/     Authentication and authorization middleware
    repositories/   MySQL data access
    routes/         API route definitions
    services/       Business logic
    utils/          Small shared backend utilities
  scripts/          Backend smoke-test scripts

frontend-angular/
  src/app/
    core/           Auth, layout, and permission services
    features/       Auth, dashboard, availability, employees, schedule
    shared/         Shared frontend utilities

db-mysql/
  schema/           Fresh-install schema
  seed/             Demo data and ML training demo data
  migrations/       Legacy upgrade scripts for older local databases

ml/
  models/           Trained model artifacts
  ml_utils.py
  train_shift_requirements_model.py
  predict_shift_requirements.py

archive/
  project-prompts/  Historical planning/prompt files, not required to run
```

## Database Flow

For a clean setup, `db-mysql/schema/schema.sql` is the source of truth for the
final schema. Then load `db-mysql/seed/seed.sql` for demo users, employees,
shifts, and availability. The optional
`db-mysql/seed/ml_shift_performance_seed.sql` file adds synthetic historical
data used by the ML training workflow.

The files under `db-mysql/migrations/` are kept as a legacy upgrade path for
older local demo databases. They are not required when creating a fresh
database from `schema/schema.sql`.

## Quick Start

Full setup instructions are in `SETUP_AND_RUN.md`.

```powershell
mysql -u root -p smart_shift < db-mysql/schema/schema.sql
mysql -u root -p smart_shift < db-mysql/seed/seed.sql
mysql -u root -p smart_shift < db-mysql/seed/ml_shift_performance_seed.sql
```

Create `backend-node.js/.env` with the MySQL settings and `JWT_SECRET`, then
run the backend:

```powershell
cd backend-node.js
npm install
npm start
```

Run the frontend:

```powershell
cd frontend-angular
npm install
npm run build
npm start
```

Run the ML workflow from the project root:

```powershell
python -m pip install -r ml/requirements.txt
python ml/train_shift_requirements_model.py
python ml/predict_shift_requirements.py --shift-id 1 --day-of-week 5 --shift-type evening --is-weekend --expected-customer-load 230 --manager-rating 8.4
```

Backend smoke test:

```powershell
cd backend-node.js
npm run test:ml
```
