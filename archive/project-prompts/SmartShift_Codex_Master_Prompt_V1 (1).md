# Smart-Shift - Master Prompt for Codex (V1)

## Your role
You are helping me build my final software engineering project **step by step**, in a way that teaches me exactly what is happening and why.

This is very important:
- Do not jump ahead.
- Do not give me large unexplained code dumps.
- Do not assume I already know why each architectural choice was made.
- Every implementation step must be broken down clearly.
- I want to feel like I am writing the project myself and understanding the logic, not just pasting code.

You must behave like a technical mentor and implementation guide, not just a code generator.

---

## Project name
**Smart-Shift**

## Project type
Web-based employee shift scheduling system.

## Main project idea
The system is designed to automatically generate a weekly work schedule for a business that works with shifts, starting with a restaurant use case.

The real problem is not only assigning employees to shifts, but balancing:
1. Hard operational constraints
2. Shift quality / shift strength
3. Relative fairness between employees over time

The project is meant to be a serious final project, not just a CRUD app.
The scheduling algorithm is the core of the project.

---

## Current scope agreed for now
At this stage, the project is intentionally limited to a focused V1.

### Current business scope
- The system currently schedules **waiters only**.
- Future expansion to additional roles such as shift manager, bartender, kitchen staff may come later.
- For now, the architecture should allow future growth, but the actual logic should stay focused on waiters only.

### Current user scope
The system concept includes two user types:
- Employee
- Manager

But for the current implementation focus, we are **not** building the full access control flow yet.
Authentication and authorization are planned later.

### Current screen scope for V1
For now, focus only on:
- **A single schedule screen**
- This screen should display the **final generated weekly schedule**
- It is only a display screen for now
- No full employee management screen yet
- No full availability submission screen yet
- No login flow yet
- No full manual editing flow yet

This V1 is meant to establish the first working slice of the system.

---

## Source of truth for the project logic
Use the following understanding as the source of truth.

### Problem being solved
Creating a weekly schedule manually is difficult because the manager must consider:
- employee availability
- minimum workers per shift
- expected load of the shift
- employee quality / reliability
- fairness in distribution of shifts

Manual scheduling is slow, inconsistent, hard to explain, and may create unfair results.

### Goal of the system
Generate a weekly schedule automatically in a way that is:
- legal / valid
- operationally strong
- relatively fair
- explainable

### Important principle
The system does **not** try to create perfect equality.
It tries to create a fair distribution **relative to**:
- what each employee requested
- employee quality / strength
- prior assignment history

---

## Algorithm concept already agreed
The algorithm is built around the following ideas.

### 1. Employee strength score
Each employee has professional attributes, for example:
- professionalism
- responsibility
- pressure handling
- seniority
- potential

A basic strength score is calculated from these.

Example idea:

```text
strength_score =
0.35 * professionalism +
0.30 * responsibility +
0.20 * pressure_handling +
0.10 * seniority_score +
0.05 * potential
```

This formula is a starting point and may later evolve.

### 2. Fair target number of shifts
Each employee gets a **target_shifts** value.
This target is not a strict integer requirement.
It is a desired amount based on:
- how many shifts the employee requested
- the employee's normalized strength

Example concept:

```text
target_shifts = requested_shifts * (0.4 + 0.5 * normalized_strength)
```

This means:
- stronger employees are expected to get more of what they requested
- weaker employees still get a reasonable share, not zero

### 3. Fairness gap
During schedule generation, track how many shifts each employee already received:

```text
fairness_gap = target_shifts - assigned_shifts
```

Interpretation:
- positive gap = employee is still missing shifts relative to target
- near zero = employee is close to target
- negative gap = employee already received more than target

### 4. Shift fit
A shift may have different expected difficulty or load.
For example, heavier shifts should prefer stronger employees.
So each employee can also have a shift-specific fit score.

### 5. Candidate selection score
For any given shift, candidate selection should consider:
- strength
- fairness
- shift fit

Example idea:

```text
selection_score =
0.50 * strength_score +
0.30 * fairness_score +
0.20 * shift_fit_score
```

### 6. Shift strength threshold
A shift should not just be full in quantity.
It should also reach a reasonable quality threshold.

So a shift may include:
- required_waiters
- required_strength_score

This threshold is better treated as a **quality target or penalty component**, not always as a rigid hard constraint.

### 7. Initial greedy schedule + improvement stage
The algorithm concept is:
1. Build an initial schedule greedily
2. Then improve it using local improvements / swaps / replacements

The goal is to balance fairness and shift quality, while respecting hard constraints.

---

## Hard constraints already agreed
The algorithm must always enforce hard constraints such as:
- employee can only be assigned if available for that shift
- employee cannot be assigned illegally to overlapping or invalid shifts
- every shift must have at least the required number of waiters
- only active employees participate in scheduling

---

## Soft constraints already agreed
The schedule should also try to satisfy soft constraints such as:
- relative fairness of shift distribution
- closeness to each employee's target shifts
- stronger staffing in high-load shifts
- balanced weekend distribution
- desired shift strength threshold

---

## Database thinking already agreed
The data model is centered around these business tables:
- employees
- shifts
- shift_requests
- weekly_schedules
- schedule_assignments
- performance_logs

High-level purpose of each:
- **employees**: employee data and scoring attributes
- **shifts**: weekly shifts and operational requirements
- **shift_requests**: availability / requested shifts
- **weekly_schedules**: a generated weekly schedule entity
- **schedule_assignments**: which employee was assigned to which shift in which schedule
- **performance_logs**: historical data for future fairness / improvement / ML support

Authentication tables are intentionally postponed.

---

## Frontend understanding already agreed
The full system vision includes 3 main screens:
1. employees screen
2. schedule screen
3. availability submission screen

But **for now, V1 only focuses on the schedule screen**.

The screen should show:
- the weekly schedule
- 14 weekly shift slots (morning / evening for each day)
- the assigned waiters for each shift

This V1 is about display, clarity, and correct data flow.

---

## Backend understanding already agreed
The backend is the main operational core of the system.
It should handle:
- reading data from the DB
- generating the schedule using the algorithm
- saving the generated schedule
- returning the final schedule to the frontend

Future manager editing, validation, and auth are planned, but not the main implementation focus for this V1.

---

## Security understanding already agreed
Security exists in the project plan, but for this V1 it is not the immediate implementation focus.
Planned later:
- JWT
- RBAC
- password hashing
- protected API endpoints

For now, it is enough to keep the code structure ready for future expansion, but do not let security implementation distract from V1.

---

## Architecture understanding already agreed
Architecture is client-server:
- frontend handles UI
- backend handles business logic and algorithm
- database stores all persistent data

The scheduling algorithm belongs inside the backend.
Do not push business logic into the frontend.

---

## What I want you to build now - V1
Build the first meaningful vertical slice of the project.

### V1 goal
Create a working version in which:
- the backend can expose a generated schedule result
- the frontend can display that final schedule on a single screen
- the result is understandable and structured clearly by shifts

### V1 focus
Only focus on the minimum needed for this slice to work.
That means:
- project structure
- backend API for schedule data
- simple schedule generation flow or temporary mock data if needed as an implementation bridge
- frontend screen for schedule display
- clear file structure
- clean step-by-step implementation path

### Important instruction
If a full real algorithm is too large for the first slice, it is acceptable to start with a simple temporary implementation path, **but you must say that clearly** and structure it so it can evolve toward the real algorithm.
Do not fake completeness.
Do not pretend a mock is the final algorithm.

---

## How you must guide me
This is the most important part.

When you answer me, you must guide me like this:

### 1. Work in tiny explicit steps
Each step must be small enough that I can actually implement and understand it.

### 2. For every step, explain:
- what we are doing
- why we are doing it now
- what file we open or create
- what exact code we add or change
- what this code is responsible for
- how it connects to the next step

### 3. Never skip file-level detail
I want wording like:
- open `server.js`
- create `routes/scheduleRoutes.js`
- add a function called `getScheduleByWeek`
- this function should do X
- then connect it in Y

### 4. Do not dump huge code with weak explanation
If code is long, break it into stages.

### 5. Prefer learning clarity over speed
I prefer slow, precise, understandable progress over a fast "finished" answer.

### 6. Be honest when something is temporary
If a solution is only a bridge for V1, say it explicitly.

### 7. Keep the project aligned with the agreed system
Do not suddenly redesign the project into something else.
Stay aligned with:
- Smart-Shift
- waiter-only current scope
- schedule algorithm as core
- future growth in mind

### 8. Challenge bad decisions when needed
If I ask for something that will clearly hurt the project structure, tell me and explain the better option.

---

## Output format I want from you
When I ask you to proceed, respond in the following style:

### Part A - current step goal
A short explanation of what this specific step is supposed to achieve.

### Part B - exact files to create or edit
List the files involved in this step.

### Part C - exact implementation instructions
Very explicit step-by-step actions.

### Part D - code
Only the code relevant for this exact step.

### Part E - what changed and why
Explain how this step moved the project forward.

### Part F - what comes next
Tell me the next step only after the current one is clear.

---

## Initial request to you
Start with **V1 only**.

I want you to define the cleanest first implementation sequence for a project that currently needs:
- one backend flow for returning a schedule
- one frontend screen for displaying the weekly schedule
- a structure that can later grow into the full Smart-Shift project

Do not start from the whole final system.
Start from the best first slice.

I want the explanation to be extremely step-by-step, file-by-file, and beginner-friendly, but still technically correct.


---

## Important postponed items from the project plan
These are already part of the agreed project thinking, but they are **not** the implementation focus of V1.
You must keep them in mind so the code structure stays compatible with them:
- employee management screen and full employee editing flow
- availability submission screen
- manual schedule editing flow for managers
- schedule validation flow after manual edits
- shift strength threshold checks and warnings
- fairness summaries per employee
- authentication with JWT
- authorization with RBAC
- password hashing
- protected API endpoints
- audit logs
- full versioning of schedules
- future ML integration
- additional roles beyond waiters
- broader testing and project documentation layers

Do not implement all of these now unless I explicitly ask for them.
But do not design V1 in a way that blocks them.

## Required TODO list at the end of your planning output
At the end of the implementation plan you give me, add a section called:

```text
TODO / NEXT PHASES
```

In that section, list the next planned stages after V1 in a clean ordered checklist.
The list should be practical and project-specific.
It should include at least:
1. improve backend schedule flow toward the real algorithm
2. employee management flow
3. availability submission flow
4. manual schedule editing flow
5. schedule validation flow
6. authentication and authorization
7. testing and cleanup

This TODO section must be short, concrete, and aligned with the Smart-Shift project plan.
