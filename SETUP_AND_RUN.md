# Smart-Shift Setup and Run Guide

This guide explains how to run the Smart-Shift backend on a new computer.

## 1. Required Software

Install these first:

- Node.js
- npm
- MySQL Server
- A MySQL client, such as MySQL Workbench, phpMyAdmin, or the `mysql` command line
- Thunder Client or Postman for testing the API

To check Node.js and npm:

```powershell
node -v
npm -v
```

## 2. Install Backend Dependencies

From the project root:

```powershell
cd backend-node.js
npm install
```

This installs the backend dependencies from `package.json`.

## 3. Create the Database

Open your MySQL client and run:

```sql
CREATE DATABASE smart_shift;
```

Then select the database:

```sql
USE smart_shift;
```

## 4. Run `schema.sql`

Run the schema file:

```text
db-mysql/schema/schema.sql
```

Using the MySQL command line from the project root:

```powershell
mysql -u root -p smart_shift < db-mysql/schema/schema.sql
```

This creates the tables:

- `employees`
- `shifts`
- `shift_requests`
- `weekly_schedules`
- `schedule_assignments`

## 5. Run `seed.sql`

Run the seed file:

```text
db-mysql/seed/seed.sql
```

Using the MySQL command line from the project root:

```powershell
mysql -u root -p smart_shift < db-mysql/seed/seed.sql
```

This inserts demo data for employees, shifts, and shift requests.

## 6. Create the `.env` File

Inside `backend-node.js`, create a file named:

```text
.env
```

Use this format:

```env
PORT=3000
DB_HOST=localhost
DB_PORT=3306
DB_NAME=smart_shift
DB_USER=root
DB_PASSWORD=your_password_here
```

Change `DB_USER` and `DB_PASSWORD` to match your local MySQL setup.

## 7. Start the Backend

From the backend folder:

```powershell
cd backend-node.js
npm start
```

Expected output:

```text
Smart-Shift server is running on port 3000
```

The backend base URL is:

```text
http://localhost:3000
```

## 8. Test `POST /api/schedules/generate`

In Thunder Client or Postman:

Method:

```text
POST
```

URL:

```text
http://localhost:3000/api/schedules/generate
```

Headers:

```text
Content-Type: application/json
```

Body:

```json
{
  "weekStartDate": "2026-04-19"
}
```

## 9. What Should Happen on First Run

The first request for a week should return:

```text
201 Created
```

Expected response shape:

```json
{
  "message": "Schedule generated successfully",
  "weekStartDate": "2026-04-19",
  "weekEndDate": "2026-04-25",
  "algorithmResult": {
    "forcedShifts": [],
    "forcedAssignments": [],
    "orderedShifts": [],
    "remainingAssignments": [],
    "allAssignments": [],
    "shiftValidationSummaries": []
  },
  "persistenceResult": {
    "scheduleId": 1,
    "weekStartDate": "2026-04-19",
    "savedAssignmentCount": 20
  }
}
```

The exact counts can be different depending on the seed data.

The backend should save:

- one row in `weekly_schedules`
- multiple rows in `schedule_assignments`

You can verify with:

```sql
SELECT *
FROM weekly_schedules
WHERE week_start_date = '2026-04-19';
```

```sql
SELECT *
FROM schedule_assignments
WHERE schedule_id = 1;
```

## 10. What Should Happen on Second Run for the Same Week

If you send the same request again for:

```json
{
  "weekStartDate": "2026-04-19"
}
```

The backend should return:

```text
409 Conflict
```

Expected response:

```json
{
  "message": "Schedule already exists for this week"
}
```

This happens because `weekly_schedules.week_start_date` is unique, and the backend has a duplicate-week guard.

No new schedule row should be created, and no new assignments should be inserted.

## 11. Common Errors

### `ECONNREFUSED`

The backend server is not running, or the request is using the wrong port.

Fix:

```powershell
cd backend-node.js
npm start
```

### `Access denied for user`

The MySQL username or password in `.env` is incorrect.

Fix:

Check:

```env
DB_USER=root
DB_PASSWORD=your_password_here
```

### `Unknown database 'smart_shift'`

The database was not created.

Fix:

```sql
CREATE DATABASE smart_shift;
```

Then run `schema.sql` and `seed.sql`.

### `Table ... doesn't exist`

The schema file was not run, or it was run on the wrong database.

Fix:

```powershell
mysql -u root -p smart_shift < db-mysql/schema/schema.sql
```

### `weekStartDate is required`

The request body is missing `weekStartDate`, or the request is not being sent as JSON.

Fix:

Use:

```json
{
  "weekStartDate": "2026-04-19"
}
```

And set:

```text
Content-Type: application/json
```

### `Schedule already exists for this week`

The schedule was already generated for that `weekStartDate`.

This is expected on the second request for the same week.

### `Cannot save a generated schedule without assignments`

The algorithm did not produce any assignments.

Possible causes:

- no shift requests exist for the selected week
- no active waiter employees exist
- the seed data was not inserted correctly
- the selected week does not match the seeded shifts
