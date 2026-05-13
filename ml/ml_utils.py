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
WAITER_MODEL_PATH = MODELS_DIR / "waiter_demand_model.joblib"
STRENGTH_MODEL_PATH = MODELS_DIR / "strength_demand_model.joblib"

MODEL_VERSION = "shift_requirements_rf_v1"

RAW_FEATURE_NAMES = [
    "day_of_week",
    "shift_type",
    "is_weekend",
    "expected_customer_load",
    "manager_rating",
]

MODEL_FEATURE_NAMES = [
    "day_of_week",
    "is_weekend",
    "expected_customer_load",
    "manager_rating",
    "shift_type_morning",
    "shift_type_evening",
]

TARGET_NAMES = ["actual_waiters_count", "actual_strength_score"]


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
          shift_date,
          shift_type,
          day_of_week,
          is_weekend,
          expected_customer_load,
          actual_waiters_count,
          actual_strength_score,
          manager_rating
        FROM shift_performance_logs
        ORDER BY shift_date, shift_type
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


def preprocess_features(dataframe: pd.DataFrame) -> pd.DataFrame:
    missing_columns = [
        column for column in RAW_FEATURE_NAMES if column not in dataframe.columns
    ]

    if missing_columns:
        raise ValueError(f"Missing required feature columns: {missing_columns}")

    features = dataframe[RAW_FEATURE_NAMES].copy()
    features["day_of_week"] = features["day_of_week"].astype(int)
    features["is_weekend"] = features["is_weekend"].astype(int)
    features["expected_customer_load"] = features["expected_customer_load"].astype(float)
    features["manager_rating"] = features["manager_rating"].astype(float)
    features["shift_type"] = features["shift_type"].astype(str).str.lower()

    encoded = pd.get_dummies(features, columns=["shift_type"], prefix="shift_type")

    for column in MODEL_FEATURE_NAMES:
        if column not in encoded.columns:
            encoded[column] = 0

    return encoded[MODEL_FEATURE_NAMES].astype(float)


def postprocess_prediction(waiters: float, strength: float) -> dict[str, float | int]:
    recommended_waiters = max(1, int(round(float(waiters))))
    recommended_strength_score = min(100.0, max(0.0, round(float(strength), 1)))

    return {
        "recommended_waiters": recommended_waiters,
        "recommended_strength_score": recommended_strength_score,
    }


def load_metadata() -> dict[str, Any]:
    with METADATA_PATH.open("r", encoding="utf-8") as metadata_file:
        return json.load(metadata_file)


def ensure_models_dir() -> None:
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
