# Smart-Shift - נתונים שצריך להקליד ידנית במחשב חדש

הקובץ הזה הוא רק רשימת עזר.  
לא צריך להעלות אותו ל-GitHub.

## 1. כתובת GitHub של הפרויקט

במחשב השני צריך לדעת מאיפה להוריד את הפרויקט:

```text
https://github.com/USERNAME/smart-shift.git
```

להחליף `USERNAME` בשם המשתמש האמיתי שלך ב-GitHub.

פקודה:

```powershell
git clone https://github.com/USERNAME/smart-shift.git
cd smart-shift
```

## 2. סיסמת MySQL במחשב השני

הסיסמה הזאת לא נמצאת בפרויקט ולא עולה ל-GitHub.

צריך לדעת מה הסיסמה של המשתמש המקומי ב-MySQL, בדרך כלל:

```text
DB_USER=root
DB_PASSWORD=הסיסמה שבחרת בהתקנת MySQL
```

אם שכחת סיסמה ואין דאטה חשוב, הכי פשוט להתקין MySQL מחדש ולבחור סיסמה חדשה.

## 3. שם ה-Database

צריך ליצור ידנית:

```sql
CREATE DATABASE smart_shift;
```

שם ה-DB שהפרויקט מצפה לו:

```text
smart_shift
```

## 4. קובץ backend-node.js/.env

הקובץ הזה לא מגיע מ-GitHub.  
צריך ליצור אותו ידנית במחשב השני:

```text
backend-node.js/.env
```

התוכן שצריך לשים בו:

```env
PORT=3000
DB_HOST=localhost
DB_PORT=3306
DB_NAME=smart_shift
DB_USER=root
DB_PASSWORD=PUT_YOUR_MYSQL_PASSWORD_HERE
JWT_SECRET=PUT_A_LONG_SECRET_HERE
```

מה צריך להחליף:

```text
PUT_YOUR_MYSQL_PASSWORD_HERE = סיסמת MySQL במחשב השני
PUT_A_LONG_SECRET_HERE = מחרוזת ארוכה כלשהי, למשל smart_shift_secret_123456
```

דוגמה מקומית:

```env
PORT=3000
DB_HOST=localhost
DB_PORT=3306
DB_NAME=smart_shift
DB_USER=root
DB_PASSWORD=123456
JWT_SECRET=smart_shift_secret_123456789
```

## 5. פקודות טעינת Database

אחרי יצירת ה-DB, צריך להריץ מתוך תיקיית הפרויקט:

```powershell
mysql -u root -p smart_shift < db-mysql/schema/schema.sql
mysql -u root -p smart_shift < db-mysql/seed/seed.sql
mysql -u root -p smart_shift < db-mysql/seed/ml_shift_performance_seed.sql
```

בכל פעם שהפקודה מבקשת password, להקליד את סיסמת MySQL של המחשב השני.

## 6. נתונים שלא יעברו אם לא מייצאים DB

הדברים האלה לא עוברים דרך GitHub:

```text
עובדים חדשים שהוספת ידנית
זמינויות שעובדים סימנו
סידורים שיצרת
שינויים ידניים בסידור
סידורים שפורסמו
פידבקים למשמרות
ML predictions שנוצרו תוך כדי שימוש
```

אם משתמשים רק ב-`seed.sql`, מקבלים דאטה דמו נקי.

אם רוצים להעביר את הדאטה האמיתי מהמחשב הישן, צריך לעשות export/import ל-MySQL.  
זה דורש גישה לסיסמת MySQL הישנה.

## 7. משתמשי דמו אחרי seed.sql

אחרי טעינת seed, אפשר להתחבר עם:

```text
manager@example.com
leader@example.com
employee@example.com
```

סיסמה לכולם:

```text
password
```

## 8. תלויות שלא עוברות מ-GitHub

התיקיות האלה לא עוברות וצריך ליצור אותן מחדש עם התקנה:

```text
backend-node.js/node_modules
frontend-angular/node_modules
Python packages
```

פקודות:

```powershell
cd backend-node.js
npm install
```

```powershell
cd frontend-angular
npm install
```

```powershell
python -m pip install -r ml/requirements.txt
```

## 9. אם ML לא עובד

אם חסרים מודלים או רוצים לאמן מחדש:

```powershell
python ml/train_shift_requirements_model.py
```

כדי שזה יעבוד צריך קודם:

```text
MySQL פעיל
backend-node.js/.env קיים
ml_shift_performance_seed.sql נטען
Python packages מותקנים
```

## 10. רשימת דברים לזכור לפני מעבר מחשב

```text
1. GitHub repo URL
2. MySQL password במחשב החדש
3. DB name: smart_shift
4. תוכן backend-node.js/.env
5. להריץ schema.sql
6. להריץ seed.sql
7. להריץ ml_shift_performance_seed.sql
8. npm install ב-backend
9. npm install ב-frontend
10. pip install ל-ML
```
