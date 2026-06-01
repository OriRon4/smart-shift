from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import mysql.connector
import pandas as pd
from dotenv import load_dotenv


# הנתיב הראשי של הפרויקט כולו.
# Path(__file__) הוא הקובץ הנוכחי, resolve() הופך אותו לנתיב מלא,
# parent.parent עולה שתי תיקיות: מתוך ml/ml_utils.py אל תיקיית הפרויקט.
PROJECT_ROOT = Path(__file__).resolve().parent.parent

# תיקיית ה-ML בתוך הפרויקט. כאן נמצאים סקריפטי האימון, החיזוי,
# קבצי הגדרות אפשריים, ותיקיית המודלים המאומנים.
ML_DIR = PROJECT_ROOT / "ml"

# התיקייה שבה נשמרים קבצי המודל אחרי אימון.
# אם התיקייה לא קיימת, הפונקציה ensure_models_dir תיצור אותה.
MODELS_DIR = ML_DIR / "models"

# נתיבים קבועים לקבצים שה-ML שומר או קורא.
# metadata הוא קובץ JSON עם מידע על גרסת המודל, זמן האימון, features ו-metrics.
METADATA_PATH = MODELS_DIR / "model_metadata.json"

# קובץ המודל שמנבא כמה מלצרים נדרשים למשמרת.
WAITER_MODEL_PATH = MODELS_DIR / "waiter_demand_model.joblib"

# קובץ המודל שמנבא את חוזק הצוות הנדרש למשמרת.
STRENGTH_MODEL_PATH = MODELS_DIR / "strength_demand_model.joblib"

# גרסת המודל עוזרת לדעת באיזו גרסת אימון נוצרו התחזיות.
# זה חשוב כשמשווים תחזיות ישנות לחדשות או כשמסבירים לבוחן איזה מודל רץ.
MODEL_VERSION = "shift_requirements_rf_v1"

# שמות העמודות הגולמיות שמותר להשתמש בהן כ-features לפני עיבוד.
# אלו נתונים שידועים לפני בניית סידור עתידי, ולכן מותר לתת אותם למודל בזמן חיזוי.
RAW_FEATURE_NAMES = [
    "day_of_week",
    "shift_type",
    "is_weekend",
    "expected_customer_load",
]

# שמות ה-features אחרי עיבוד והמרה לפורמט מספרי.
# ההבדל המרכזי: shift_type הוא טקסט, ולכן אחרי one-hot encoding הוא הופך
# לשתי עמודות מספריות קבועות: shift_type_morning ו-shift_type_evening.
MODEL_FEATURE_NAMES = [
    "day_of_week",
    "is_weekend",
    "expected_customer_load",
    "shift_type_morning",
    "shift_type_evening",
]

# אלו שמות עמודות היעד שהמודל מנסה ללמוד לחזות.
# הן targets ולא features: הן התשובות הנכונות מהעבר, ולא קלט שידוע לפני משמרת עתידית.
# לכן actual_waiters_count ו-actual_strength_score לא נכנסים ל-features.
TARGET_NAMES = ["actual_waiters_count", "actual_strength_score"]


def load_project_env() -> None:
    """
    מקבלת: לא מקבלת פרמטרים.
    מחזירה: None.
    למה קיימת: טוענת משתני סביבה מקבצי .env כדי שסקריפטי ה-ML ישתמשו
    באותן הגדרות DB כמו ה-backend.
    """
    # טוענים כמה קבצי .env אפשריים כדי שהקוד יעבוד גם מהרצת backend
    # וגם מהרצה ישירה של סקריפטי Python מתוך תיקיית הפרויקט.
    load_dotenv(PROJECT_ROOT / ".env")
    load_dotenv(PROJECT_ROOT / "backend-node.js" / ".env")
    load_dotenv(ML_DIR / ".env")


def get_db_config() -> dict[str, Any]:
    """
    מקבלת: לא מקבלת פרמטרים.
    מחזירה: מילון עם פרטי התחברות ל-MySQL.
    למה קיימת: מרכזת את בניית הגדרות החיבור למסד הנתונים עבור מודול ה-ML.
    """
    # לפני בניית ההגדרות טוענים את קבצי ה-.env, כדי שמשתנים כמו DB_HOST
    # ו-DB_PASSWORD יהיו זמינים דרך os.getenv.
    load_project_env()

    # os.getenv קורא משתנה סביבה. הערך השני הוא ברירת מחדל למקרה שהמשתנה לא הוגדר.
    # כך ניתן להריץ את הפרויקט גם בסביבה מקומית פשוטה וגם במחשב אחר עם הגדרות שונות.
    return {
        "host": os.getenv("DB_HOST", "localhost"),
        "port": int(os.getenv("DB_PORT", "3306")),
        "database": os.getenv("DB_NAME", "smart_shift"),
        "user": os.getenv("DB_USER", "root"),
        "password": os.getenv("DB_PASSWORD", ""),
    }


def read_shift_performance_logs() -> pd.DataFrame:
    """
    מקבלת: לא מקבלת פרמטרים.
    מחזירה: pandas DataFrame עם היסטוריית ביצועי המשמרות מה-DB.
    למה קיימת: מספקת לסקריפט האימון את נתוני העבר שמהם המודל לומד.
    """
    # שאילתת SQL שמביאה את כל הנתונים הדרושים לאימון.
    # manager_rating נשלף כחלק מהלוג ההיסטורי, אבל הוא לא נכנס ל-features
    # משום שבזמן חיזוי משמרת עתידית הדירוג עדיין לא ידוע.
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

    # פתיחת חיבור ל-MySQL לפי ההגדרות שנבנו מ-.env או מברירות המחדל.
    connection = mysql.connector.connect(**get_db_config())
    try:
        # cursor הוא אובייקט שמריץ שאילתות מול מסד הנתונים ומחזיר תוצאות.
        # dictionary=True גורם לכל שורה לחזור כמילון: שם עמודה -> ערך.
        # זה נוח כי pandas יכול להפוך רשימת מילונים ישירות ל-DataFrame ברור.
        cursor = connection.cursor(dictionary=True)
        try:
            # הרצת השאילתה בפועל מול מסד הנתונים.
            cursor.execute(query)

            # מחזירים DataFrame כי pandas הוא הכלי המרכזי כאן לעיבוד טבלאות:
            # בחירת עמודות, המרת טיפוסים, one-hot encoding והכנה ל-scikit-learn.
            return pd.DataFrame(cursor.fetchall())
        finally:
            # סוגרים את ה-cursor כדי לשחרר משאבי DB גם אם קרתה שגיאה.
            cursor.close()
    finally:
        # סוגרים את החיבור למסד הנתונים בסיום הקריאה.
        connection.close()


def preprocess_features(dataframe: pd.DataFrame) -> pd.DataFrame:
    """
    מקבלת: DataFrame עם נתוני משמרות גולמיים.
    מחזירה: DataFrame מספרי ומסודר עם features שהמודל יכול לקבל.
    למה קיימת: מכינה את הנתונים לאימון ולחיזוי באותו פורמט קבוע.
    """
    # בודקים שכל עמודות הקלט הדרושות קיימות.
    # בלי הבדיקה הזו המודל עלול להיכשל בהמשך עם שגיאה פחות ברורה.
    missing_columns = [
        column for column in RAW_FEATURE_NAMES if column not in dataframe.columns
    ]

    if missing_columns:
        raise ValueError(f"Missing required feature columns: {missing_columns}")

    # בוחרים רק את RAW_FEATURE_NAMES כי אלו ה-features שמותר למודל לראות.
    # actual_waiters_count ו-actual_strength_score הם targets, כלומר תשובות עבר
    # שהמודל לומד לחזות, ולכן אסור להכניס אותם כקלט.
    # גם manager_rating לא נכנס ל-features כי הוא ניתן רק אחרי המשמרת,
    # ולכן לא יהיה ידוע בזמן יצירת תחזית לשבוע הבא.
    features = dataframe[RAW_FEATURE_NAMES].copy()

    # המרות טיפוסים מבטיחות שהמודל יקבל נתונים מספריים ועקביים.
    # scikit-learn מצפה למספרים, ולא לערכים מעורבים כמו strings או booleans לא אחידים.
    features["day_of_week"] = features["day_of_week"].astype(int)
    features["is_weekend"] = features["is_weekend"].astype(int)
    features["expected_customer_load"] = features["expected_customer_load"].astype(float)

    # shift_type מגיע כטקסט, ולכן הופכים אותו לאותיות קטנות כדי למנוע מצב
    # שבו "Morning" ו-"morning" ייחשבו קטגוריות שונות.
    features["shift_type"] = features["shift_type"].astype(str).str.lower()

    # pd.get_dummies מבצע one-hot encoding:
    # הוא הופך עמודת טקסט קטגורית לעמודות מספריות של 0/1.
    # לדוגמה, shift_type=morning יקבל shift_type_morning=1 ו-shift_type_evening=0.
    encoded = pd.get_dummies(features, columns=["shift_type"], prefix="shift_type")

    # ייתכן שבקלט מסוים יש רק morning או רק evening.
    # במקרה כזה get_dummies ייצור רק חלק מהעמודות, אבל המודל חייב תמיד לקבל
    # את אותן עמודות בדיוק. לכן מוסיפים עמודות חסרות עם 0.
    for column in MODEL_FEATURE_NAMES:
        if column not in encoded.columns:
            encoded[column] = 0

    # מחזירים את ה-features בסדר קבוע.
    # הסדר חשוב כי מודל ML לומד לפי מיקום העמודות, ולכן בזמן חיזוי חייבים
    # לתת לו את אותו מבנה עמודות כמו בזמן האימון.
    return encoded[MODEL_FEATURE_NAMES].astype(float)


def postprocess_prediction(waiters: float, strength: float) -> dict[str, float | int]:
    """
    מקבלת: תחזיות גולמיות של המודל עבור כמות מלצרים וחוזק צוות.
    מחזירה: מילון עם המלצות תקינות לשימוש באפליקציה.
    למה קיימת: מתרגמת פלט ML רציף לערכים עסקיים הגיוניים ובטווח תקין.
    """
    # מודל רגרסיה מחזיר מספרים רציפים, למשל 3.4 מלצרים.
    # בפועל אי אפשר לשבץ חלקי מלצר, לכן מעגלים למספר שלם.
    # בנוסף, משמרת חייבת לפחות מלצר אחד, ולכן המינימום הוא 1.
    recommended_waiters = max(1, int(round(float(waiters))))

    # חוזק צוות הוא ציון עסקי שמוגדר בטווח 0 עד 100.
    # לכן מעגלים לספרה אחת אחרי הנקודה ומגבילים את הערך שלא יחרוג מהטווח.
    recommended_strength_score = min(100.0, max(0.0, round(float(strength), 1)))

    return {
        "recommended_waiters": recommended_waiters,
        "recommended_strength_score": recommended_strength_score,
    }


def load_metadata() -> dict[str, Any]:
    """
    מקבלת: לא מקבלת פרמטרים.
    מחזירה: מילון עם metadata של המודל מתוך קובץ JSON.
    למה קיימת: מאפשרת לסקריפט החיזוי לצרף לתוצאה מידע כמו model_version.
    """
    # metadata נשמר כ-JSON כי זה פורמט פשוט, קריא, ומתאים לשמירת מידע מובנה
    # כמו גרסת מודל, זמן אימון, שמות features ומדדי איכות.
    with METADATA_PATH.open("r", encoding="utf-8") as metadata_file:
        return json.load(metadata_file)


def ensure_models_dir() -> None:
    """
    מקבלת: לא מקבלת פרמטרים.
    מחזירה: None.
    למה קיימת: מוודאת שקיימת תיקיית models לפני ששומרים קבצי מודל.
    """
    # mkdir עם parents=True יוצר גם תיקיות אב חסרות.
    # exist_ok=True מונע שגיאה אם התיקייה כבר קיימת.
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
