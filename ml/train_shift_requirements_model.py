# הקובץ הזה הוא סקריפט האימון של שכבת ה-ML בפרויקט Smart-Shift.
# הוא קורא נתוני משמרות היסטוריים מה-DB, מכין features בפורמט שהמודל יודע לקבל,
# מאמן שני מודלי Random Forest, מחשב מדדי איכות, ושומר את המודלים וה-metadata לקבצים.
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


# התפקיד של הפונקציה הוא לבנות מודל רגרסיה חדש עם אותן הגדרות בכל הרצה.
# היא לא מקבלת פרמטרים, ומחזירה אובייקט RandomForestRegressor מוכן לאימון.
# Regressor הוא מודל שמנבא ערך מספרי רציף, למשל כמות מלצרים או ציון חוזק צוות.
# RandomForestRegressor משתמש באוסף של עצי החלטה ומחשב מהם תחזית יציבה יותר
# מאשר עץ החלטה יחיד, ולכן הוא מתאים לפרויקט שבו יש קשרים לא ליניאריים בין נתוני המשמרת לתוצאה.
def build_model() -> RandomForestRegressor:
    return RandomForestRegressor(
        # n_estimators הוא מספר העצים ביער.
        # יותר עצים יכולים לשפר יציבות, אבל גם מגדילים זמן אימון וגודל מודל.
        n_estimators=120,
        # max_depth מגביל את עומק כל עץ כדי להקטין overfitting,
        # כלומר מצב שבו המודל זוכר את הדאטה במקום ללמוד דפוס כללי.
        max_depth=6,
        # random_state מקבע את האקראיות כדי שאותה הרצה על אותו דאטה
        # תיתן תוצאה שחוזרת על עצמה, וזה חשוב בהסבר ובבדיקות של פרויקט לימודי.
        random_state=42,
    )


# הפונקציה מחשבת מדדי איכות למודל אחרי שהוא כבר אומן.
# היא מקבלת מודל, features לבדיקה, ו-target אמיתי להשוואה.
# היא מחזירה מילון עם MAE ו-RMSE, כדי שנוכל להבין כמה התחזיות רחוקות מהערכים האמיתיים.
# בתהליך ה-ML היא קיימת כדי לתת מדידה מספרית ולא רק להגיד שהאימון "הצליח".
def calculate_metrics(model, features, target) -> dict[str, float]:
    # predict מפעיל את המודל על נתוני הבדיקה ומחזיר תחזיות.
    # כאן אנחנו משווים בין התחזיות לבין הערכים האמיתיים שנשמרו בהיסטוריית המשמרות.
    predictions = model.predict(features)

    # MAE הוא Mean Absolute Error: ממוצע המרחקים המוחלטים בין תחזית לערך אמיתי.
    # קל להסביר אותו כי הוא באותן יחידות של ה-target, למשל "בערך כמה מלצרים טעינו בממוצע".
    mae = mean_absolute_error(target, predictions)

    # RMSE הוא Root Mean Squared Error.
    # הוא מעניש טעויות גדולות יותר חזק יותר מ-MAE, ולכן עוזר לזהות אם יש תחזיות חריגות ורעות.
    rmse = sqrt(mean_squared_error(target, predictions))

    # מעגלים את המדדים כדי שה-metadata יהיה קריא וברור להצגה.
    return {
        "mae": round(float(mae), 3),
        "rmse": round(float(rmse), 3),
    }


# main היא פונקציית התהליך המרכזית של סקריפט האימון.
# היא לא מקבלת פרמטרים ולא מחזירה ערך, אלא מבצעת את כל תהליך ה-ML:
# קריאת דאטה, הכנת features ו-targets, אימון מודלים, בדיקה, שמירה והדפסת סיכום.
def main() -> None:
    # קריאת הדאטה ההיסטורי מטבלת shift_performance_logs.
    # אלו הדוגמאות שהמודל לומד מהן: איך נראו משמרות בעבר ומה הייתה התוצאה בפועל.
    dataframe = read_shift_performance_logs()

    # אם אין בכלל דאטה, אין למודל ממה ללמוד.
    # במקרה כזה עוצרים את הסקריפט עם הודעה ברורה במקום ליצור מודל ריק או מטעה.
    if dataframe.empty:
        raise SystemExit("No rows found in shift_performance_logs.")

    # הכנת ה-features: בחירת עמודות שמותר להשתמש בהן בזמן חיזוי עתידי,
    # המרת טיפוסים, והפיכת shift_type לעמודות מספריות בעזרת one-hot encoding.
    features = preprocess_features(dataframe)

    # הגדרת ה-targets, כלומר הערכים שהמודל צריך ללמוד לחזות.
    # יש כאן שני targets שונים, ולכן בהמשך מאמנים שני מודלים נפרדים:
    # אחד לחיזוי כמות המלצרים בפועל, ואחד לחיזוי ציון חוזק הצוות הנדרש.
    waiter_target = dataframe["actual_waiters_count"].astype(float)
    strength_target = dataframe["actual_strength_score"].astype(float)

    if len(dataframe) >= 20:
        # train_test_split מחלק את הנתונים לסט אימון וסט בדיקה.
        # המטרה היא לאמן את המודל על רוב הדאטה, ואז לבדוק אותו על נתונים שהוא לא ראה בזמן האימון.
        # test_size=0.2 אומר ש-20% מהשורות נשמרות לבדיקה ו-80% משמשות לאימון.
        # random_state כאן מבטיח שהחלוקה תהיה קבועה בין הרצות.
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
        # אם יש פחות מ-20 שורות, הפרויקט משתמש באותו דאטה גם לאימון וגם לבדיקה.
        # זה פתרון סביר לפרויקט לימודי או dataset קטן, כדי שהסקריפט עדיין יעבוד.
        # עם זאת, זו בדיקה פחות אמינה כי המודל נבדק על נתונים שהוא כבר ראה בזמן האימון,
        # ולכן המדדים עלולים להיראות טובים יותר ממה שיקרה על דאטה חדש באמת.
        features_train = features_test = features
        waiters_train = waiters_test = waiter_target
        strength_train = strength_test = strength_target

    # יוצרים שני מודלים עם אותה ארכיטקטורה, אבל כל אחד לומד target אחר.
    # מודל waiter_model לומד לחזות כמה מלצרים צריך.
    # מודל strength_model לומד לחזות איזה ציון חוזק צוות מתאים למשמרת.
    waiter_model = build_model()
    strength_model = build_model()

    # fit הוא שלב האימון בפועל.
    # המודל מקבל features של משמרות עבר ואת ה-target המתאים, ולומד את הקשר ביניהם.
    waiter_model.fit(features_train, waiters_train)
    strength_model.fit(features_train, strength_train)

    # אחרי האימון מחשבים metrics על סט הבדיקה.
    # כך אפשר לראות בנפרד את איכות מודל כמות המלצרים ואת איכות מודל חוזק הצוות.
    waiter_metrics = calculate_metrics(waiter_model, features_test, waiters_test)
    strength_metrics = calculate_metrics(strength_model, features_test, strength_test)

    # לפני שמירת קבצי המודל מוודאים שתיקיית ml/models קיימת.
    # זה מונע שגיאה במקרה שמריצים את האימון במחשב חדש או אחרי clone נקי.
    ensure_models_dir()

    # joblib.dump שומר אובייקטי scikit-learn לקובץ בצורה שמתאימה לטעינה חוזרת.
    # בהמשך סקריפט החיזוי יטען את הקבצים האלה כדי לבצע predictions בלי לאמן מחדש.
    joblib.dump(waiter_model, WAITER_MODEL_PATH)
    joblib.dump(strength_model, STRENGTH_MODEL_PATH)

    # metadata הוא מידע נלווה על המודל ולא המודל עצמו.
    # הוא עוזר להבין מתי המודל אומן, על כמה שורות, עם אילו features ו-targets,
    # ומה היו מדדי האיכות בזמן האימון.
    metadata = {
        "model_version": MODEL_VERSION,
        # שומרים זמן UTC כדי שהזמן יהיה אחיד וברור גם אם הפרויקט רץ במחשבים או אזורי זמן שונים.
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "row_count": int(len(dataframe)),
        "feature_names": MODEL_FEATURE_NAMES,
        "target_names": TARGET_NAMES,
        "metrics": {
            "waiter_demand_model": waiter_metrics,
            "strength_demand_model": strength_metrics,
        },
    }

    # שמירת ה-metadata כקובץ JSON.
    # JSON הוא פורמט קריא ופשוט להצגה, ולכן נוח לפתוח אותו ולהסביר לבוחן מה נשמר על האימון.
    with METADATA_PATH.open("w", encoding="utf-8") as metadata_file:
        json.dump(metadata, metadata_file, indent=2)

    # הדפסת סיכום בסוף הריצה מאפשרת למי שמריץ את הסקריפט לראות מיד שהאימון הסתיים,
    # איזו גרסת מודל נוצרה, כמה שורות שימשו לאימון, איפה נשמרו הקבצים ומה המדדים.
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


# התנאי הזה גורם ל-main לרוץ רק כאשר מריצים את הקובץ ישירות כ-script.
# אם הקובץ מיובא ממודול אחר, הפונקציות יהיו זמינות אבל תהליך האימון לא יתחיל אוטומטית.
if __name__ == "__main__":
    main()
