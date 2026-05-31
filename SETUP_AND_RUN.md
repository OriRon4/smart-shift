# Smart-Shift - Setup and Run From Zero

המדריך הזה מסביר איך להריץ את Smart-Shift על מחשב חדש לגמרי אחרי שמורידים את הפרויקט מ-GitHub.

הפרויקט מורכב מ:

- Frontend: Angular
- Backend: Node.js / Express
- Database: MySQL
- ML: Python scripts

## 1. התקנות חובה במחשב החדש

לפני שמתחילים, צריך להתקין:

```text
Git
Node.js + npm
MySQL Server
Python 3
MySQL Workbench או mysql command line
```

בדיקות מהירות בטרמינל:

```powershell
git --version
node --version
npm --version
python --version
mysql --version
```

אם אחת הפקודות לא עובדת, צריך להתקין את הכלי החסר או להוסיף אותו ל-PATH.

## 2. הורדת הפרויקט מ-GitHub

בוחרים תיקייה במחשב החדש ומריצים:

```powershell
git clone https://github.com/USERNAME/smart-shift.git
cd smart-shift
```

להחליף `USERNAME` בשם המשתמש האמיתי ב-GitHub.

## 3. הקמת Database חדש

פותחים MySQL Workbench או mysql command line ויוצרים database:

```sql
CREATE DATABASE smart_shift;
```

אחר כך, מתוך תיקיית הפרויקט הראשית:

```powershell
mysql -u root -p smart_shift < db-mysql/schema/schema.sql
mysql -u root -p smart_shift < db-mysql/seed/seed.sql
mysql -u root -p smart_shift < db-mysql/seed/ml_shift_performance_seed.sql
```

מה כל קובץ עושה:

- `schema.sql` יוצר את כל הטבלאות.
- `seed.sql` מכניס משתמשים, עובדים, משמרות ודאטה בסיסי.
- `ml_shift_performance_seed.sql` מכניס היסטוריית משמרות סינתטית בשביל ML.

אם אין צורך ב-ML, הקובץ השלישי לא חובה. לפרויקט מלא ולמגן כן מומלץ להריץ אותו.

## 4. יצירת קובץ Environment ל-Backend

במחשב חדש אין קובץ `.env`, כי הוא לא אמור לעלות ל-GitHub.

יוצרים קובץ:

```text
backend-node.js/.env
```

ומכניסים אליו:

```env
PORT=3000
DB_HOST=localhost
DB_PORT=3306
DB_NAME=smart_shift
DB_USER=root
DB_PASSWORD=your_mysql_password
JWT_SECRET=replace_with_a_long_random_secret
```

צריך להחליף:

- `your_mysql_password` בסיסמה האמיתית של MySQL במחשב החדש.
- `replace_with_a_long_random_secret` במחרוזת ארוכה כלשהי.

דוגמה:

```env
JWT_SECRET=smart_shift_local_secret_123456789
```

## 5. התקנת והרצת Backend

פותחים טרמינל בתיקיית הפרויקט:

```powershell
cd backend-node.js
npm install
npm start
```

אם הכל תקין, השרת רץ על:

```text
http://localhost:3000
```

כתובת ה-API היא:

```text
http://localhost:3000/api
```

חשוב להשאיר את הטרמינל הזה פתוח בזמן שעובדים עם האתר.

## 6. התקנת והרצת Frontend

פותחים טרמינל חדש, לא סוגרים את ה-Backend.

מתיקיית הפרויקט:

```powershell
cd frontend-angular
npm install
npm start
```

Angular אמור לרוץ על:

```text
http://localhost:4200
```

ה-Frontend מוגדר לקרוא ל-Backend דרך:

```text
frontend-angular/src/environments/environment.ts
```

שם אמור להיות:

```ts
export const environment = {
  apiBaseUrl: 'http://localhost:3000/api'
};
```

## 7. התקנת ML

מתיקיית הפרויקט הראשית:

```powershell
python -m pip install -r ml/requirements.txt
```

אם רוצים לאמן מחדש את המודלים:

```powershell
python ml/train_shift_requirements_model.py
```

בדיקת תחזית ידנית:

```powershell
python ml/predict_shift_requirements.py --shift-id 1 --day-of-week 5 --shift-type evening --is-weekend --expected-customer-load 230
```

אם מתקבלת תשובת JSON עם `recommended_waiters` ו-`recommended_strength_score`, ה-ML עובד.

## 8. סדר הפעלה רגיל אחרי שהכל מותקן

בכל פעם שרוצים להריץ את הפרויקט:

1. לוודא ש-MySQL Server עובד.
2. לפתוח טרמינל Backend:

```powershell
cd backend-node.js
npm start
```

3. לפתוח טרמינל Frontend:

```powershell
cd frontend-angular
npm start
```

4. לפתוח בדפדפן:

```text
http://localhost:4200
```

## 9. משתמשים לדמו

אחרי הרצת `seed.sql`, קיימים משתמשי דמו:

```text
manager@example.com
leader@example.com
employee@example.com
```

הסיסמה לכולם:

```text
password
```

## 10. בדיקות שהכל עובד

### Backend syntax check

```powershell
cd backend-node.js
node --check src/app.js
```

### Frontend build

```powershell
cd frontend-angular
npm run build
```

יכול להיות שיהיו warnings על CSS budget. אם ה-build מסתיים בהצלחה, זה לא חוסם הרצה.

### ML/API smoke test

להריץ רק אחרי שה-Backend כבר עובד על port 3000:

```powershell
cd backend-node.js
npm run test:ml
```

## 11. זרימת בדיקה ידנית מומלצת

1. להיכנס עם `manager@example.com`.
2. לפתוח Schedule.
3. ללחוץ Generate ML Recommendations.
4. לאשר או להשאיר את המלצות ה-ML.
5. ללחוץ Generate Schedule.
6. לבדוק שהסידור מופיע במסך.
7. ללחוץ Validate Schedule.
8. לפרסם עם Publish.
9. לצאת ולהיכנס כ-`employee@example.com`.
10. לבדוק שהעובד רואה את הסידור שפורסם.
11. להיכנס למסך Availability.
12. לסמן זמינות ולשלוח.

## 12. מה לא מעלים ל-GitHub

הקבצים/תיקיות האלה לא צריכים לעלות:

```text
node_modules/
dist/
.angular/
.env
.env.*
__pycache__/
*.pyc
```

הם כבר מוגדרים ב-`.gitignore`.

חשוב: לא להעלות סיסמאות אמיתיות או secrets ל-GitHub.

## 13. תקלות נפוצות

### ECONNREFUSED

ה-Frontend לא מצליח להתחבר ל-Backend.

פתרון:

```text
לוודא שה-Backend רץ על http://localhost:3000
```

### Access denied for user

ה-Backend לא מצליח להתחבר ל-MySQL.

פתרון:

```text
לבדוק DB_USER ו-DB_PASSWORD בקובץ backend-node.js/.env
```

### Unknown database smart_shift

ה-database לא נוצר.

פתרון:

```sql
CREATE DATABASE smart_shift;
```

ואז להריץ שוב את `schema.sql` ו-`seed.sql`.

### JWT_SECRET is required

חסר `JWT_SECRET` בקובץ `.env`.

פתרון:

```env
JWT_SECRET=some_long_random_secret
```

### Route not found

הכתובת לא נכונה או שה-Backend לא רץ.

פתרון:

```text
לוודא שה-Frontend משתמש ב-http://localhost:3000/api
לוודא שה-Backend רץ
```

### ML prediction failed

המודלים חסרים או ש-Python dependencies לא הותקנו.

פתרון:

```powershell
python -m pip install -r ml/requirements.txt
python ml/train_shift_requirements_model.py
```

### Schedule has not been published yet

זו לא בהכרח תקלה.

עובד או אחראי משמרת לא רואים סידור שלא פורסם. צריך להיכנס כמנהל וללחוץ Publish.

## 14. סדר מלא מקוצר

```text
1. Install Git, Node.js, MySQL, Python
2. git clone
3. CREATE DATABASE smart_shift
4. Run schema.sql
5. Run seed.sql
6. Run ml_shift_performance_seed.sql
7. Create backend-node.js/.env
8. cd backend-node.js
9. npm install
10. npm start
11. cd frontend-angular
12. npm install
13. npm start
14. python -m pip install -r ml/requirements.txt
15. python ml/train_shift_requirements_model.py
16. Open http://localhost:4200
```
