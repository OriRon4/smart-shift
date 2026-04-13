# Smart-Shift Project Plan

## Overview

Smart-Shift is a restaurant shift scheduling system designed to automatically generate weekly schedules for waiters based on constraints such as availability and worker strength.

This project is a final software engineering project and must demonstrate:
- Clear architecture
- Algorithmic thinking
- Clean and maintainable code
- Incremental development

---

## Core Concept

The system generates a weekly schedule using a multi-step heuristic algorithm:

1. Calculate worker strength
2. Build an initial schedule based on strength
3. Evaluate shift quality
4. Improve schedule (fairness + balance)

---

## Current State (IMPORTANT)

Already implemented:

- MySQL Database:
  - employees
  - shifts
  - shift_requests
  - weekly_schedules
  - schedule_assignments

- Backend:
  - Node.js + Express
  - Single file implementation (`index.js`)

- Algorithm (Partial):
  - Worker strength calculation:
    - `strength = 0.4 * professionalism + 0.4 * responsibility + 0.2 * pressure_handling`
  - Initial assignment based ONLY on strength

- Basic UI:
  - HTML page fetching and displaying schedule

---

## Project Goals

### 1. Refactor Backend (High Priority)

Convert the backend into a clean, modular structure.

#### Required Structure

```text
backend-node.js
frontend-angular
db-mysql
```

---

## TODO List

### Project Setup

- [ ] Create the base project folders:
  - `backend-node.js`
  - `frontend-angular`
  - `db-mysql`
- [ ] Move the current backend code out of the single `index.js` file into the new backend structure
- [ ] Add a clear README for the project architecture and setup steps

### Backend Refactor

- [ ] Split Express server setup into dedicated modules
- [ ] Create separate folders for routes, controllers, services, and database configuration
- [ ] Move MySQL connection logic into its own reusable module
- [ ] Separate scheduling logic from HTTP route handling
- [ ] Add environment variable support for database credentials and server configuration
- [ ] Add basic error handling middleware

### Scheduling Algorithm

- [ ] Keep the current worker strength formula as the first scoring stage
- [ ] Implement initial weekly schedule generation based on worker strength
- [ ] Add validation for employee availability before assignment
- [ ] Add shift coverage rules to ensure every shift has enough workers
- [ ] Create a schedule quality scoring function
- [ ] Improve fairness by balancing number of shifts across workers
- [ ] Improve balance by distributing stronger workers across the week
- [ ] Add an improvement phase that adjusts weak schedules

### Database Work

- [ ] Review and document the schema for all existing tables
- [ ] Create SQL scripts for schema creation and seed data
- [ ] Add sample employee and shift request data for testing
- [ ] Ensure generated schedules are saved correctly into `weekly_schedules` and `schedule_assignments`

### Frontend

- [ ] Create the Angular frontend project inside `frontend-angular`
- [ ] Build a page to display the generated weekly schedule
- [ ] Add a form for employee shift requests or availability input
- [ ] Connect the frontend to backend API endpoints
- [ ] Improve the UI so it is clear enough for project demonstration

### API Endpoints

- [ ] Create an endpoint to fetch employees
- [ ] Create an endpoint to fetch shifts
- [ ] Create an endpoint to submit shift requests
- [ ] Create an endpoint to generate a weekly schedule
- [ ] Create an endpoint to fetch saved schedules

### Testing And Quality

- [ ] Add unit tests for worker strength calculation
- [ ] Add unit tests for schedule quality evaluation
- [ ] Add tests for fairness and balance improvements
- [ ] Add API tests for schedule generation endpoints
- [ ] Test edge cases such as not enough workers or conflicting availability

### Final Project Preparation

- [ ] Prepare a step-by-step explanation of the scheduling algorithm
- [ ] Document the system architecture with a simple diagram
- [ ] Prepare demo data for presentation
- [ ] Verify the project shows incremental development and clean code practices
