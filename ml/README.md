# Smart-Shift ML

The ML layer predicts only waiter demand.

## Flow

1. `Finish Shift` saves the real result into `shift_performance_logs`.
2. The backend starts `train_shift_requirements_model.py` in the background.
3. Training reads synthetic and real rows.
4. The latest successful model is saved as `ml/models/waiter_demand_model.joblib`.
5. `predict_shift_requirements.py` loads that saved model and returns `recommended_waiters`.
6. Apply ML updates `shifts.required_waiters`.

Prediction does not retrain the model.

## Features

The model uses only values that are safe before a future shift:

- `day_of_week`
- `shift_type`
- `is_weekend`
- `avg_waiters_needed_same_day_shift`
- `avg_customers_same_day_shift`

It does not use future actual values like manager rating, waiter gap, or actual customers.

## Target

- `actual_waiters_needed`

## Commands

Train:

```bash
python ml/train_shift_requirements_model.py
```

Predict one shift:

```bash
python ml/predict_shift_requirements.py --shift-id 1 --day-of-week 5 --shift-type evening --is-weekend
```
