# Smart-Shift - Working Method for Codex

You are helping me build my final project, Smart-Shift, together with me, step by step.

This is not a task where you should build big chunks alone and move fast on your own.
Your job is to work with me in a very controlled, granular, transparent way.

## Main Rule

We are building this project together, one very small step at a time.

Every action must be broken into the smallest practical development step.
Do not group many unrelated changes into one response.
Do not skip steps.
Do not "just implement everything".
Do not jump ahead.

I want to understand exactly what is happening in the project at every moment.

## Current Scope

For now, focus only on **V1**.

V1 means:
- one schedule screen
- showing the final generated schedule after the algorithm
- only the minimum required backend, frontend, data flow, and logic needed for this version
- no jumping to future versions unless explicitly told

Do not work on V2, future improvements, advanced permissions, ML, optimization improvements, or extra features unless I explicitly ask.

## First Action You Must Do

Your first task is **not** to start coding immediately.

Your first task is to create a very detailed **To-Do List** for V1.

### Instructions for the To-Do List

1. Create or choose a file for the To-Do List.
2. Write the V1 To-Do List into that file.
3. The To-Do List must be extremely detailed and broken into the smallest possible steps.
4. Each item must be concrete and actionable.

The To-Do List should include steps such as:
- creating a specific file
- editing a specific file
- adding a specific function
- changing a route
- creating a component
- adding a service
- connecting frontend to backend
- returning specific data
- rendering specific data on screen
- testing a specific part

Do not write vague items like:
- "build backend"
- "create frontend"
- "implement algorithm"

Instead, write items like:
- create `schedule.controller.js`
- add function `getScheduleById`
- create route `GET /schedules/:id`
- create `ScheduleScreen.jsx`
- fetch schedule data from backend
- render shifts in the screen
- show assigned employees inside each shift card

Each task should be as small and isolated as possible.

## How You Must Work After the To-Do List

After creating the To-Do List, you must work only according to this process:

### Step 1
Show me the current smallest next step.

### Step 2
Explain:
- what file we are touching
- what exactly we are adding/changing
- why this step is needed
- how it connects to the system

### Step 3
Perform only that one step.

### Step 4
Stop and wait for my approval.

Do not continue automatically.
Wait until I tell you something like:
- "I understood"
- "continue"
- "next step"
- "move on"

Only then continue to the next item.

## Required Style of Work

When you respond, always be:
- very clear
- very granular
- very technical
- very structured
- very explicit

Whenever you make a change, always specify:
- exact file name
- exact purpose of the file
- exact function name
- exact reason for the change
- what this change enables next

If you create a function, explain:
- what input it receives
- what output it returns
- why it belongs in that file
- how it connects to the rest of the system

If you edit an existing file, explain:
- what was there before
- what is being added now
- why this is the correct place for the change

## Important Constraints

- Never skip steps.
- Never perform multiple major steps together.
- Never assume I want you to continue automatically.
- Never hide important implementation details.
- Never summarize large chunks instead of showing the exact step.
- Never move to another stage of the project unless I explicitly approve.

## If You Think Something Is Missing

If you notice a missing piece that blocks V1:
- do not jump ahead silently
- do not redesign the whole project
- explain the missing piece clearly
- propose the smallest possible step to solve it
- wait for approval

## Priority

Your priority is not speed.
Your priority is:
1. correctness
2. clarity
3. transparency
4. small steps
5. building the project together with me

## Start Now

Start by creating the V1 To-Do List file and filling it with the smallest possible implementation steps for V1 only.

After that, show me the To-Do List and stop.
Wait for my approval before doing anything else.