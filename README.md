# Smart-Shift

Smart-Shift is a restaurant shift scheduling system for a Grade 14 software
engineering final project.

## Main Stack

- Frontend: Angular
- Backend: Node.js / Express
- Database: MySQL
- Security: JWT authentication, RBAC, bcrypt password hashing
- ML: Python scripts that predict shift requirements before scheduling

## Final System Scope

Smart-Shift supports:

- login and worker registration
- role-based access for manager, shift manager, and employee
- employee management
- employee availability submission and manager review
- schedule generation with a heuristic scheduling algorithm
- schedule editing, replace/remove assignments, validation, and publish/unpublish
- shift requirement editing
- ML recommendations for:
  - `recommended_waiters`
  - `recommended_strength_score`

ML does not assign employees and does not replace the scheduling algorithm.
Managers review and apply ML recommendations before the heuristic algorithm uses
the updated shift requirement fields.

## Project Structure

```text
backend-node.js/
  src/
    algorithms/
    config/
    constants/
    controllers/
    middleware/
    repositories/
    routes/
    services/
    utils/
  scripts/

frontend-angular/
  src/
    app/
      core/
      features/
        auth/
        availability/
        dashboard/
        employees/
        schedule/
      shared/

db-mysql/
  schema/
  migrations/
  seed/

ml/
  models/
  train_shift_requirements_model.py
  predict_shift_requirements.py
  ml_utils.py
```

## Quick Start

See `SETUP_AND_RUN.md` for full setup instructions.

Useful commands:

```powershell
cd backend-node.js
npm install
npm start
```

```powershell
cd frontend-angular
npm install
npm run build
npm start
```

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
