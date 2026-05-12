# Smart-Shift ML Module

This folder is reserved for the final Smart-Shift machine learning workflow.

The ML component predicts shift demand requirements before the scheduling
algorithm runs. It does not assign employees to shifts.

The planned prediction outputs are:

- `recommended_waiters`
- `recommended_strength_score`

The existing heuristic scheduling algorithm remains the core scheduling engine.
ML recommendations will later be reviewed by a manager and applied to the
existing `shifts.required_waiters` and `shifts.required_strength_score` fields
only after approval.

## Data Strategy

Stage 1 uses seeded synthetic historical data in `shift_performance_logs`.
This data is for demonstration and training workflow validation. It is not real
production restaurant data.

In a real deployment, managers would record actual shift performance after each
shift. Those logs would gradually replace or improve the demo data used for
training.

## Planned Workflow

1. Read historical shift performance data.
2. Train a model for recommended waiter demand.
3. Train a model for recommended strength demand.
4. Save trained model artifacts under `ml/models/`.
5. Generate recommendations for existing shifts.
6. Store recommendations in `shift_ml_predictions`.
7. Let the manager review and apply recommendations in the app.

Stage 1 only creates the folder structure and database foundation. It does not
connect ML predictions to the backend or frontend yet.
