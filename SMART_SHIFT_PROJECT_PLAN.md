# Smart-Shift Project Plan

## Overview

Smart-Shift is a restaurant shift scheduling system designed to automatically generate a weekly waiter schedule based on employee availability, manager-defined worker attributes, and shift coverage requirements.

This project is a final software engineering project and must demonstrate:
- Clear architecture
- Algorithmic thinking
- Clean and maintainable code
- Incremental development

The first version of Smart-Shift focuses on producing a valid and explainable schedule, not on full real-world automation.

---

## Core Concept

The system generates a weekly schedule using a heuristic scheduling algorithm that prioritizes valid assignment, shift strength, and basic fairness.

1. Calculate worker strength from manager-defined attributes
2. Select only workers who are available for each shift
3. Build an initial schedule by assigning the strongest valid workers first
4. Check that each shift meets minimum worker coverage
5. Evaluate schedule quality using shift strength and assignment fairness
6. Improve the schedule by replacing assignments when a better valid option exists

---

## Scope Of Current Version

The current version focuses on a single weekly schedule for waiters only.

In this version:
- Worker attributes are entered manually by the manager
- The schedule is generated for one week at a time
- The algorithm uses availability, worker strength, and basic fairness
- Historical schedule data is not yet part of the first scheduling decision
- Automatic performance updates and machine learning enhancements will be added in later stages

---

## First Version Scheduling Assumptions

For the first version:
- The manager defines worker attributes manually
- The schedule is generated for one week only
- Historical balancing across previous weeks is postponed
- Automatic updates to worker scores are postponed
- Shift requirements are defined manually before schedule generation
- Machine learning is not part of the first scheduling implementation
- Workers may be assigned to both morning and evening shifts on the same day

---

## Current State (IMPORTANT)

Already implemented:

- MySQL Database:
  - employees
  - shifts
  - shift_requests
  - weekly_schedules
  - schedule_assignments

Important note:
The existing database structure stores employees, shifts, availability requests, weekly schedules, and final assignments, but the first algorithm version will use manager-entered worker attributes as the main input for decision making.

- Backend:
  - Node.js + Express
  - Single file implementation (`index.js`)

- Algorithm (Partial):
  - Worker strength calculation:
    - `strength = 0.4 * professionalism + 0.4 * responsibility + 0.2 * pressure_handling`
  - Initial assignment currently based only on strength among workers who are available for the shift

- Basic UI:
  - HTML page fetching and displaying schedule

Current development focus:
- Complete a working schedule generation algorithm for one weekly schedule
- Keep worker attributes manager-defined in the first version
- Postpone automatic worker scoring updates and historical balancing to later stages

---

## Project Goals

### 1. Build a working first version for one weekly schedule (High Priority)

### 2. Define the first scheduling rules clearly

The first version of the project must explicitly define:
- How worker strength is calculated
- How shift coverage is checked
- How available workers are filtered
- How fairness is measured for one week
- How a valid schedule is evaluated before improvement

### 3. Refactor Backend (Secondary Priority)

Convert the backend into a clean, modular structure.

#### Required Structure

```text
backend-node
frontend-angular
db-mysql
```

---

## TODO List

### Project Setup

- [x] Create the base project folders:
  - `backend-node.js`
  - `frontend-angular`
  - `db-mysql`
- [x] Move the current backend code out of the single `index.js` file into the new backend structure
- [x] Add a clear README for the project architecture and setup steps

### Backend Refactor

- [x] Split Express server setup into dedicated modules
- [x] Create separate folders for routes, controllers, services, and database configuration
- [x] Move MySQL connection logic into its own reusable module
- [x] Separate scheduling logic from HTTP route handling
- [x] Add environment variable support for database credentials and server configuration
- [x] Add basic error handling middleware

### Scheduling Algorithm

- [ ] Define the exact worker attributes used in the first version
- [ ] Document the worker strength formula and its weights
- [ ] Add a penalty rule for workers with very low responsibility or reliability
- [ ] Ensure only available workers can be assigned to a shift
- [ ] Prevent duplicate assignment of the same worker to the same shift
- [ ] Define the minimum required number of waiters per shift
- [ ] Add support for manager-defined required waiters per shift
- [ ] Process shifts in priority order (harder shifts first)
- [ ] Allow workers to be assigned to both morning and evening shifts in the same day
- [ ] Implement initial weekly schedule generation based on worker strength
- [ ] Define what makes a shift valid before scoring it
- [ ] Define a basic fairness rule for one week only
- [ ] Keep the first fairness version simple: compare number of assigned shifts to number of requested shifts
- [ ] Create a schedule scoring function based on shift coverage, worker strength, and fairness
- [ ] Improve fairness by considering how many shifts each worker requested compared to how many shifts they were assigned
- [ ] Improve overall shift quality by avoiding weak shifts and distributing worker strength more reasonably across the week
- [ ] Add an improvement loop that adjusts weak schedules without breaking validity
- [ ] Add an improvement phase that adjusts weak schedules

### Database Work

- [ ] Review and document the schema for all existing tables
- [ ] Create SQL scripts for schema creation and seed data
- [ ] Add sample employee and shift request data for testing
- [ ] Ensure generated schedules are saved correctly into `weekly_schedules` and `schedule_assignments`
- [ ] Verify that employee attributes needed for strength calculation exist in the schema
- [ ] Add fields for professionalism, responsibility, pressure_handling, and potential if they do not already exist
- [ ] Verify that each shift record can store the number of required waiters
- [ ] Verify whether worker attributes are stored directly in the employees table or in a separate related table

### Frontend

- [ ] Create the Angular frontend project inside `frontend-angular`
- [ ] Build a page to display the generated weekly schedule
- [ ] Add a form for employee shift requests or availability input
- [ ] Build a page to manage employee attributes manually in the first version
- [ ] Build a page to define weekly shift requirements before generating the schedule
- [ ] Connect the frontend to backend API endpoints
- [ ] Improve the UI so it is clear enough for project demonstration

### API Endpoints

- [ ] Create an endpoint to fetch employees
- [ ] Create an endpoint to fetch shifts
- [ ] Create an endpoint to submit shift requests
- [ ] Create an endpoint to generate a weekly schedule
- [ ] Create an endpoint to fetch saved schedules
- [ ] Create an endpoint to update worker attributes
- [ ] Create an endpoint to fetch worker attributes for schedule generation
- [ ] Create an endpoint to set or update required waiters per shift

### Testing And Quality

- [ ] Add unit tests for worker strength calculation
- [ ] Add unit tests for schedule quality evaluation
- [ ] Add tests for fairness and balance improvements
- [ ] Add API tests for schedule generation endpoints
- [ ] Add tests for edge cases such as not enough workers or conflicting availability
- [ ] Add tests to verify that unavailable workers are never assigned
- [ ] Add tests to verify that every shift meets minimum coverage when possible
- [ ] Add tests for penalty behavior when a worker has a very low critical attribute
- [ ] Add tests to verify that the improvement step never breaks schedule validity

### Final Project Preparation

- [ ] Prepare a step-by-step explanation of the scheduling algorithm
- [ ] Document the system architecture with a simple diagram
- [ ] Prepare demo data for presentation
- [ ] Verify the project shows incremental development and clean code practices
- [ ] Prepare a clear explanation of the first-version scope and what is intentionally postponed
- [ ] Prepare a short explanation of future extensions: historical balancing, automatic scoring updates, and ML-based load prediction

---

## Future Extensions

Later versions may include:
- Historical balancing across multiple weeks
- Automatic worker score updates based on shift performance data
- Load prediction using machine learning
- Dynamic calculation of required waiters per shift
- More advanced fairness logic
