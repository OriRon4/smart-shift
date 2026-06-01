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
    TARGET_NAME,
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
        for column in [TARGET_NAME, "actual_customers", "day_of_week", "shift_type"]
        if column not in dataframe.columns
    ]

    if missing_columns:
        raise RuntimeError(f"Missing training columns: {missing_columns}")

    dataframe = dataframe.dropna(subset=[TARGET_NAME, "actual_customers"])
    dataframe = add_training_historical_average_features(dataframe)
    features = preprocess_features(dataframe)
    target = dataframe[TARGET_NAME].astype(float)

    if len(dataframe) >= 20:
        features_train, features_test, target_train, target_test = train_test_split(
            features,
            target,
            test_size=0.2,
            random_state=42,
        )
    else:
        features_train = features_test = features
        target_train = target_test = target

    model = build_model()
    model.fit(features_train, target_train)
    metrics = calculate_metrics(model, features_test, target_test)

    ensure_models_dir()
    joblib.dump(model, WAITER_MODEL_PATH)

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
        "target_name": TARGET_NAME,
        "model_file_path": str(WAITER_MODEL_PATH),
        "model_format": "joblib",
        "metrics": {
            "waiter_demand_model": metrics,
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
                    "target": metadata["target_name"],
                    "metrics": metadata["metrics"],
                    "model_file": metadata["model_file_path"],
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
