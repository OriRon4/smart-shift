from __future__ import annotations

import json
from datetime import datetime, timezone
from math import sqrt

import joblib
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error
from sklearn.model_selection import train_test_split

from ml_utils import (
    METADATA_PATH,
    MODEL_FEATURE_NAMES,
    MODEL_VERSION,
    STRENGTH_MODEL_PATH,
    TARGET_NAMES,
    WAITER_MODEL_PATH,
    ensure_models_dir,
    preprocess_features,
    read_shift_performance_logs,
)


def build_model() -> RandomForestRegressor:
    return RandomForestRegressor(
        n_estimators=120,
        max_depth=6,
        random_state=42,
    )


def calculate_metrics(model, features, target) -> dict[str, float]:
    predictions = model.predict(features)
    mae = mean_absolute_error(target, predictions)
    rmse = sqrt(mean_squared_error(target, predictions))

    return {
        "mae": round(float(mae), 3),
        "rmse": round(float(rmse), 3),
    }


def main() -> None:
    dataframe = read_shift_performance_logs()

    if dataframe.empty:
        raise SystemExit("No rows found in shift_performance_logs.")

    features = preprocess_features(dataframe)
    waiter_target = dataframe["actual_waiters_count"].astype(float)
    strength_target = dataframe["actual_strength_score"].astype(float)

    if len(dataframe) >= 20:
        split = train_test_split(
            features,
            waiter_target,
            strength_target,
            test_size=0.2,
            random_state=42,
        )
        (
            features_train,
            features_test,
            waiters_train,
            waiters_test,
            strength_train,
            strength_test,
        ) = split
    else:
        features_train = features_test = features
        waiters_train = waiters_test = waiter_target
        strength_train = strength_test = strength_target

    waiter_model = build_model()
    strength_model = build_model()

    waiter_model.fit(features_train, waiters_train)
    strength_model.fit(features_train, strength_train)

    waiter_metrics = calculate_metrics(waiter_model, features_test, waiters_test)
    strength_metrics = calculate_metrics(strength_model, features_test, strength_test)

    ensure_models_dir()
    joblib.dump(waiter_model, WAITER_MODEL_PATH)
    joblib.dump(strength_model, STRENGTH_MODEL_PATH)

    metadata = {
        "model_version": MODEL_VERSION,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "row_count": int(len(dataframe)),
        "feature_names": MODEL_FEATURE_NAMES,
        "target_names": TARGET_NAMES,
        "metrics": {
            "waiter_demand_model": waiter_metrics,
            "strength_demand_model": strength_metrics,
        },
    }

    with METADATA_PATH.open("w", encoding="utf-8") as metadata_file:
        json.dump(metadata, metadata_file, indent=2)

    print(
        json.dumps(
            {
                "message": "Training completed",
                "model_version": MODEL_VERSION,
                "row_count": int(len(dataframe)),
                "features": MODEL_FEATURE_NAMES,
                "metrics": metadata["metrics"],
                "model_files": [
                    str(WAITER_MODEL_PATH),
                    str(STRENGTH_MODEL_PATH),
                    str(METADATA_PATH),
                ],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
