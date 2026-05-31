from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import joblib
import pandas as pd

from ml_utils import (
    METADATA_PATH,
    STRENGTH_MODEL_PATH,
    WAITER_MODEL_PATH,
    load_metadata,
    postprocess_prediction,
    preprocess_features,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Predict Smart-Shift shift requirement recommendations."
    )
    parser.add_argument(
        "--input-file",
        type=Path,
        help="JSON file containing a shift object or a list of shift objects.",
    )
    parser.add_argument("--shift-id", type=int)
    parser.add_argument("--day-of-week", type=int)
    parser.add_argument("--shift-type", choices=["morning", "evening"])
    parser.add_argument("--is-weekend", action="store_true")
    parser.add_argument("--expected-customer-load", type=int)
    return parser


def load_input(args: argparse.Namespace) -> list[dict[str, Any]]:
    if args.input_file:
        with args.input_file.open("r", encoding="utf-8") as input_file:
            payload = json.load(input_file)

        if isinstance(payload, dict) and "shifts" in payload:
            payload = payload["shifts"]

        if isinstance(payload, dict):
            return [payload]

        if isinstance(payload, list):
            return payload

        raise ValueError("Input file must contain an object, a list, or { shifts: [] }.")

    required = {
        "day_of_week": args.day_of_week,
        "shift_type": args.shift_type,
        "expected_customer_load": args.expected_customer_load,
    }
    missing = [key for key, value in required.items() if value is None]

    if missing:
        raise ValueError(
            "Missing CLI arguments: "
            + ", ".join(missing)
            + ". Use --input-file or provide all required shift features."
        )

    return [
        {
            "shift_id": args.shift_id,
            "day_of_week": args.day_of_week,
            "shift_type": args.shift_type,
            "is_weekend": args.is_weekend,
            "expected_customer_load": args.expected_customer_load,
        }
    ]


def validate_models_exist() -> None:
    missing = [
        path
        for path in [WAITER_MODEL_PATH, STRENGTH_MODEL_PATH, METADATA_PATH]
        if not path.exists()
    ]

    if missing:
        raise FileNotFoundError(
            "Missing trained model files: "
            + ", ".join(str(path) for path in missing)
            + ". Run train_shift_requirements_model.py first."
        )


def main() -> None:
    args = build_parser().parse_args()
    validate_models_exist()

    shifts = load_input(args)
    dataframe = pd.DataFrame(shifts)
    features = preprocess_features(dataframe)
    metadata = load_metadata()

    waiter_model = joblib.load(WAITER_MODEL_PATH)
    strength_model = joblib.load(STRENGTH_MODEL_PATH)

    waiter_predictions = waiter_model.predict(features)
    strength_predictions = strength_model.predict(features)
    predictions = []

    for index, shift in enumerate(shifts):
        prediction = postprocess_prediction(
            waiter_predictions[index],
            strength_predictions[index],
        )
        predictions.append(
            {
                "shift_id": shift.get("shift_id"),
                **prediction,
                "model_version": metadata["model_version"],
            }
        )

    print(json.dumps({"predictions": predictions}, indent=2))


if __name__ == "__main__":
    main()
