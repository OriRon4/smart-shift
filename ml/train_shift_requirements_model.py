from __future__ import annotations

import json
import traceback
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
    STRENGTH_TARGET_NAME,
    WAITER_TARGET_NAME,
    WAITER_MODEL_PATH,
    add_training_historical_average_features,
    ensure_models_dir,
    preprocess_features,
    read_shift_performance_logs,
    write_training_status,
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_model() -> RandomForestRegressor:
    return RandomForestRegressor(
        n_estimators=120,
        max_depth=7,
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


def train() -> dict:
    dataframe = read_shift_performance_logs()

    if dataframe.empty:
        raise RuntimeError("No rows found in shift_performance_logs.")

    missing_columns = [
        column
        for column in [
            WAITER_TARGET_NAME,
            STRENGTH_TARGET_NAME,
            "actual_customers",
            "day_of_week",
            "shift_type",
        ]
        if column not in dataframe.columns
    ]

    if missing_columns:
        raise RuntimeError(f"Missing training columns: {missing_columns}")

    dataframe = dataframe.dropna(
        subset=[WAITER_TARGET_NAME, "actual_customers", STRENGTH_TARGET_NAME]
    )
    dataframe = add_training_historical_average_features(dataframe)
    features = preprocess_features(dataframe)
    waiter_target = dataframe[WAITER_TARGET_NAME].astype(float)
    strength_target = dataframe[STRENGTH_TARGET_NAME].astype(float)

    if len(dataframe) >= 20:
        (
            features_train,
            features_test,
            waiter_target_train,
            waiter_target_test,
            strength_target_train,
            strength_target_test,
        ) = train_test_split(
            features,
            waiter_target,
            strength_target,
            test_size=0.2,
            random_state=42,
        )
    else:
        features_train = features_test = features
        waiter_target_train = waiter_target_test = waiter_target
        strength_target_train = strength_target_test = strength_target

    waiter_model = build_model()
    strength_model = build_model()
    waiter_model.fit(features_train, waiter_target_train)
    strength_model.fit(features_train, strength_target_train)
    waiter_metrics = calculate_metrics(
        waiter_model, features_test, waiter_target_test
    )
    strength_metrics = calculate_metrics(
        strength_model, features_test, strength_target_test
    )

    ensure_models_dir()
    joblib.dump(waiter_model, WAITER_MODEL_PATH)
    joblib.dump(strength_model, STRENGTH_MODEL_PATH)

    synthetic_row_count = int(dataframe["is_synthetic"].astype(bool).sum())
    real_row_count = int(len(dataframe) - synthetic_row_count)
    metadata = {
        "model_version": MODEL_VERSION,
        "training_status": "success",
        "trained_at": utc_now(),
        "row_count": int(len(dataframe)),
        "synthetic_row_count": synthetic_row_count,
        "real_row_count": real_row_count,
        "feature_names": MODEL_FEATURE_NAMES,
        "target_names": {
            "waiter_demand_model": WAITER_TARGET_NAME,
            "strength_demand_model": STRENGTH_TARGET_NAME,
        },
        "model_files": {
            "waiter_demand_model": str(WAITER_MODEL_PATH),
            "strength_demand_model": str(STRENGTH_MODEL_PATH),
        },
        "model_format": "joblib",
        "metrics": {
            "waiter_demand_model": waiter_metrics,
            "strength_demand_model": strength_metrics,
        },
    }

    with METADATA_PATH.open("w", encoding="utf-8") as metadata_file:
        json.dump(metadata, metadata_file, indent=2)

    write_training_status(
        {
            "training_status": "success",
            "model_version": MODEL_VERSION,
            "trained_at": metadata["trained_at"],
            "row_count": metadata["row_count"],
        }
    )

    return metadata


def main() -> None:
    try:
        metadata = train()
        print(
            json.dumps(
                {
                    "message": "Training completed",
                    "model_version": metadata["model_version"],
                    "row_count": metadata["row_count"],
                    "synthetic_row_count": metadata["synthetic_row_count"],
                    "real_row_count": metadata["real_row_count"],
                    "features": metadata["feature_names"],
                    "targets": metadata["target_names"],
                    "metrics": metadata["metrics"],
                    "model_files": metadata["model_files"],
                },
                indent=2,
            )
        )
    except Exception as error:
        write_training_status(
            {
                "training_status": "failed",
                "failed_at": utc_now(),
                "error": str(error),
                "traceback": traceback.format_exc(),
            }
        )
        raise


if __name__ == "__main__":
    main()
