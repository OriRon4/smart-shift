# Smart-Shift Setup and Run Guide

This guide explains how to run Smart-Shift locally for development and final
demo testing.

## 1. Requirements

- Node.js and npm
- MySQL Server
- Python 3
- MySQL client, such as MySQL Workbench or the `mysql` command line

## 2. Database Setup

Create the database:

```sql
CREATE DATABASE smart_shift;
```

From the project root, run the final schema. This file is the source of truth
for the clean Smart-Shift database structure:

```powershell
mysql -u root -p smart_shift < db-mysql/schema/schema.sql
```

Run core demo data:

```powershell
mysql -u root -p smart_shift < db-mysql/seed/seed.sql
```

Optionally run synthetic ML training demo data:

```powershell
mysql -u root -p smart_shift < db-mysql/seed/ml_shift_performance_seed.sql
```

No migrations are required for a new database. Legacy migration files are kept
only for reference under `archive/db-mysql/migrations/`.

## 3. Backend Environment

Create `backend-node.js/.env`:

```env
PORT=3000
DB_HOST=localhost
DB_PORT=3306
DB_NAME=smart_shift
DB_USER=root
DB_PASSWORD=your_password_here
JWT_SECRET=replace_with_a_long_random_secret
```

`JWT_SECRET` is required. The backend should not start without it.

## 4. Backend

```powershell
cd backend-node.js
npm install
npm start
```

Backend URL:

```text
http://localhost:3000
```

API base URL:

```text
http://localhost:3000/api
```

## 5. Frontend

```powershell
cd frontend-angular
npm install
npm start
```

Angular runs locally on:

```text
http://localhost:4200
```

The frontend API URL is centralized in:

```text
frontend-angular/src/environments/environment.ts
```

## 6. ML Scripts

Install Python dependencies from the project root:

```powershell
python -m pip install -r ml/requirements.txt
```

Train models:

```powershell
python ml/train_shift_requirements_model.py
```

Run one prediction example:

```powershell
python ml/predict_shift_requirements.py --shift-id 1 --day-of-week 5 --shift-type evening --is-weekend --expected-customer-load 230 --manager-rating 8.4
```

The ML demo data is synthetic. It is used for project demonstration, not claimed
as real restaurant production data.

## 7. Demo Accounts

All seeded demo accounts use password:

```text
password
```

Accounts:

- Manager: `manager@example.com`
- Shift manager: `leader@example.com`
- Employee: `employee@example.com`

## 8. Final Smoke Tests

Frontend build:

```powershell
cd frontend-angular
npm run build
```

Backend syntax check example:

```powershell
cd backend-node.js
node --check src/app.js
```

Backend ML/API smoke test, with backend already running on port 3000:

```powershell
cd backend-node.js
npm run test:ml
```

## 9. Recommended Manual Demo Flow

1. Login as manager.
2. Open Schedule.
3. Generate ML recommendations.
4. Open a shift requirement editor and apply one ML recommendation.
5. Generate schedule.
6. Replace or remove an assignment.
7. Save changes.
8. Validate schedule.
9. Publish schedule.
10. Login as employee and verify the published schedule is visible.
11. Unpublish as manager and verify employee no longer sees the schedule.
12. Submit/update employee availability.

## 10. Common Issues

`ECONNREFUSED`: backend is not running on port 3000.

`Access denied for user`: check `DB_USER` and `DB_PASSWORD` in `.env`.

`JWT_SECRET is required`: add `JWT_SECRET` to `.env`.

`Route not found`: confirm the frontend uses `http://localhost:3000/api` and
the backend was restarted after code changes.

`Schedule has not been published yet`: expected for employee/shift manager when
manager has not published the selected week.
