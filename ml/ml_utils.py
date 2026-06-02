from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import mysql.connector
import pandas as pd
from dotenv import load_dotenv


PROJECT_ROOT = Path(__file__).resolve().parent.parent
ML_DIR = PROJECT_ROOT / "ml"
MODELS_DIR = ML_DIR / "models"

METADATA_PATH = MODELS_DIR / "model_metadata.json"
TRAINING_STATUS_PATH = MODELS_DIR / "training_status.json"
WAITER_MODEL_PATH = MODELS_DIR / "waiter_demand_model.joblib"
STRENGTH_MODEL_PATH = MODELS_DIR / "strength_demand_model.joblib"

MODEL_VERSION = "waiter_demand_rf_v2"

RAW_FEATURE_NAMES = [
    "day_of_week",
    "shift_type",
    "is_weekend",
    "avg_waiters_needed_same_day_shift",
    "avg_customers_same_day_shift",
]

MODEL_FEATURE_NAMES = [
    "day_of_week",
    "is_weekend",
    "avg_waiters_needed_same_day_shift",
    "avg_customers_same_day_shift",
    "shift_type_morning",
    "shift_type_evening",
]

WAITER_TARGET_NAME = "actual_waiters_needed"
STRENGTH_TARGET_NAME = "actual_strength_score"

SAFE_FALLBACKS = {
    "morning": {
        "avg_waiters_needed_same_day_shift": 2.5,
        "avg_customers_same_day_shift": 55.0,
    },
    "evening": {
        "avg_waiters_needed_same_day_shift": 5.5,
        "avg_customers_same_day_shift": 180.0,
    },
}


def load_project_env() -> None:
    load_dotenv(PROJECT_ROOT / ".env")
    load_dotenv(PROJECT_ROOT / "backend-node.js" / ".env")
    load_dotenv(ML_DIR / ".env")


def get_db_config() -> dict[str, Any]:
    load_project_env()

    return {
        "host": os.getenv("DB_HOST", "localhost"),
        "port": int(os.getenv("DB_PORT", "3306")),
        "database": os.getenv("DB_NAME", "smart_shift"),
        "user": os.getenv("DB_USER", "root"),
        "password": os.getenv("DB_PASSWORD", ""),
    }


def read_shift_performance_logs() -> pd.DataFrame:
    query = """
        SELECT
          id,
          shift_id,
          shift_date,
          shift_type,
          day_of_week,
          is_weekend,
          scheduled_waiters,
          actual_customers,
          actual_waiters_needed,
          actual_strength_score,
          manager_rating,
          waiter_gap,
          was_understaffed,
          was_overstaffed,
          is_synthetic,
          created_at,
          updated_at
        FROM shift_performance_logs
        ORDER BY shift_date, shift_type, id
    """

    connection = mysql.connector.connect(**get_db_config())
    try:
        cursor = connection.cursor(dictionary=True)
        try:
            cursor.execute(query)
            return pd.DataFrame(cursor.fetchall())
        finally:
            cursor.close()
    finally:
        connection.close()


def ensure_models_dir() -> None:
    MODELS_DIR.mkdir(parents=True, exist_ok=True)


def get_shift_type_fallback(shift_type: str, column: str) -> float:
    normalized_shift_type = str(shift_type).lower()
    fallback = SAFE_FALLBACKS.get(normalized_shift_type, SAFE_FALLBACKS["evening"])

    return float(fallback[column])


def add_training_historical_average_features(dataframe: pd.DataFrame) -> pd.DataFrame:
    if dataframe.empty:
        return dataframe.copy()

    enriched = dataframe.copy()
    enriched["shift_date"] = pd.to_datetime(enriched["shift_date"])
    enriched["shift_type"] = enriched["shift_type"].astype(str).str.lower()
    enriched["shift_order"] = enriched["shift_type"].map({"morning": 0, "evening": 1}).fillna(2)
    enriched = enriched.sort_values(["shift_date", "shift_order", "id"]).reset_index(drop=True)

    grouped = enriched.groupby(["day_of_week", "shift_type"], sort=False)
    enriched["avg_waiters_needed_same_day_shift"] = grouped[WAITER_TARGET_NAME].transform(
        lambda values: values.expanding().mean().shift(1)
    )
    enriched["avg_customers_same_day_shift"] = grouped["actual_customers"].transform(
        lambda values: values.expanding().mean().shift(1)
    )

    for column in [
        "avg_waiters_needed_same_day_shift",
        "avg_customers_same_day_shift",
    ]:
        enriched[column] = enriched.apply(
            lambda row: (
                get_shift_type_fallback(row["shift_type"], column)
                if pd.isna(row[column])
                else row[column]
            ),
            axis=1,
        )

    return enriched


def build_prediction_features_from_history(shifts: list[dict[str, Any]]) -> pd.DataFrame:
    history = read_shift_performance_logs()
    rows: list[dict[str, Any]] = []

    for shift in shifts:
        day_of_week = int(shift["day_of_week"])
        shift_type = str(shift["shift_type"]).lower()
        matching_history = history[
            (history["day_of_week"].astype(int) == day_of_week)
            & (history["shift_type"].astype(str).str.lower() == shift_type)
        ]

        if matching_history.empty:
            avg_waiters = get_shift_type_fallback(
                shift_type, "avg_waiters_needed_same_day_shift"
            )
            avg_customers = get_shift_type_fallback(
                shift_type, "avg_customers_same_day_shift"
            )
        else:
            avg_waiters = float(matching_history["actual_waiters_needed"].mean())
            avg_customers = float(matching_history["actual_customers"].mean())

        rows.append(
            {
                "shift_id": shift.get("shift_id"),
                "day_of_week": day_of_week,
                "shift_type": shift_type,
                "is_weekend": bool(shift["is_weekend"]),
                "avg_waiters_needed_same_day_shift": avg_waiters,
                "avg_customers_same_day_shift": avg_customers,
            }
        )

    return pd.DataFrame(rows)


def preprocess_features(dataframe: pd.DataFrame) -> pd.DataFrame:
    missing_columns = [
        column for column in RAW_FEATURE_NAMES if column not in dataframe.columns
    ]

    if missing_columns:
        raise ValueError(f"Missing required feature columns: {missing_columns}")

    features = dataframe[RAW_FEATURE_NAMES].copy()
    features["day_of_week"] = features["day_of_week"].astype(int)
    features["is_weekend"] = features["is_weekend"].astype(int)
    features["avg_waiters_needed_same_day_shift"] = features[
        "avg_waiters_needed_same_day_shift"
    ].astype(float)
    features["avg_customers_same_day_shift"] = features[
        "avg_customers_same_day_shift"
    ].astype(float)
    features["shift_type"] = features["shift_type"].astype(str).str.lower()

    encoded = pd.get_dummies(features, columns=["shift_type"], prefix="shift_type")

    for column in MODEL_FEATURE_NAMES:
        if column not in encoded.columns:
            encoded[column] = 0

    return encoded[MODEL_FEATURE_NAMES].astype(float)


def postprocess_prediction(waiters: float, strength: float) -> dict[str, int | float]:
    recommended_waiters = int(round(float(waiters)))
    recommended_waiters = min(10, max(1, recommended_waiters))
    recommended_strength_score = round(float(strength), 1)
    recommended_strength_score = min(100.0, max(0.0, recommended_strength_score))

    return {
        "recommended_waiters": recommended_waiters,
        "recommended_strength_score": recommended_strength_score,
    }


def load_metadata() -> dict[str, Any]:
    with METADATA_PATH.open("r", encoding="utf-8") as metadata_file:
        return json.load(metadata_file)


def write_training_status(status: dict[str, Any]) -> None:
    ensure_models_dir()
    with TRAINING_STATUS_PATH.open("w", encoding="utf-8") as status_file:
        json.dump(status, status_file, indent=2)
