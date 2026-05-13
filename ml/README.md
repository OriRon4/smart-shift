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

## Setup

Create a Python virtual environment if desired, then install the minimal ML
dependencies:

```bash
python -m pip install -r ml/requirements.txt
```

The scripts read database settings from environment variables. For local
development they also load `backend-node.js/.env`, so the same MySQL settings
used by the backend can be reused.

## Training

Train the two regression models from `shift_performance_logs`:

```bash
python ml/train_shift_requirements_model.py
```

The training script uses these features:

- `day_of_week`
- `shift_type`
- `is_weekend`
- `expected_customer_load`
- `manager_rating`

It creates:

- `ml/models/waiter_demand_model.joblib`
- `ml/models/strength_demand_model.joblib`
- `ml/models/model_metadata.json`

The metadata file contains model version, training time, row count, feature
names, target names, and test metrics.

## Prediction

Predict one shift directly from CLI arguments:

```bash
python ml/predict_shift_requirements.py --shift-id 1 --day-of-week 5 --shift-type evening --is-weekend --expected-customer-load 230 --manager-rating 8.4
```

Or pass a JSON file:

```bash
python ml/predict_shift_requirements.py --input-file ml/data/example_shift.json
```

The prediction output includes:

- `shift_id`
- `recommended_waiters`
- `recommended_strength_score`
- `model_version`

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
