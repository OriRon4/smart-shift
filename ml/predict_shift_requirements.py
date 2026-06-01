from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import joblib

from ml_utils import (
    METADATA_PATH,
    WAITER_MODEL_PATH,
    build_prediction_features_from_history,
    load_metadata,
    postprocess_prediction,
    preprocess_features,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Predict Smart-Shift waiter demand recommendations."
    )
    parser.add_argument(
        "--input-file",
        type=Path,
        help="JSON file containing { shifts: [] } or a single shift object.",
    )
    parser.add_argument("--shift-id", type=int)
    parser.add_argument("--day-of-week", type=int)
    parser.add_argument("--shift-type", choices=["morning", "evening"])
    parser.add_argument("--is-weekend", action="store_true")
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
        }
    ]


def validate_model_exists() -> None:
    missing = [
        path for path in [WAITER_MODEL_PATH, METADATA_PATH] if not path.exists()
    ]

    if missing:
        raise FileNotFoundError("ML model not trained yet.")


def main() -> None:
    args = build_parser().parse_args()
    validate_model_exists()

    shifts = load_input(args)
    prediction_dataframe = build_prediction_features_from_history(shifts)
    features = preprocess_features(prediction_dataframe)
    metadata = load_metadata()
    model = joblib.load(WAITER_MODEL_PATH)
    waiter_predictions = model.predict(features)
    predictions = []

    for index, shift in enumerate(shifts):
        prediction = postprocess_prediction(waiter_predictions[index])
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
