import { HttpClient } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { catchError, map, Observable, of, tap } from 'rxjs';

import { environment } from '../../../environments/environment';
import { AuthUser, LoginResponse } from './auth.models';

const TOKEN_STORAGE_KEY = 'smartShiftToken';
const USER_STORAGE_KEY = 'smartShiftUser';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  // כתובת הבסיס לכל קריאות ההתחברות בשרת.
  private readonly apiUrl = `${environment.apiBaseUrl}/auth`;
  private isSessionVerified = false;
  // שומר בזיכרון את המשתמש הנוכחי כדי שרכיבים ו-guards יוכלו לקרוא אותו.
  readonly currentUser = signal<AuthUser | null>(this.readStoredUser());

  constructor(private readonly http: HttpClient) {}

  // שולח התחברות לשרת ומחזיר Observable שהקומפוננטה עושה עליו subscribe.
  login(login: string, password: string): Observable<LoginResponse> {
    return this.http
      // POST אל /api/auth/login עם שם משתמש/אימייל וסיסמה.
      .post<LoginResponse>(`${this.apiUrl}/login`, {
        login,
        password
      })
      .pipe(
        // אם השרת אישר התחברות, שומרים token ומשתמש להמשך הבקשות.
        tap((response) => {
          localStorage.setItem(TOKEN_STORAGE_KEY, response.token);
          localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(response.user));
          this.isSessionVerified = true;
          this.currentUser.set(response.user);
        })
      );
  }

  registerWorker(worker: {
    fullName: string;
    username: string;
    email: string;
    password: string;
  }): Observable<LoginResponse> {
    return this.http
      .post<LoginResponse>(`${this.apiUrl}/register-worker`, worker)
      .pipe(
        tap((response) => {
          localStorage.setItem(TOKEN_STORAGE_KEY, response.token);
          localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(response.user));
          this.isSessionVerified = true;
          this.currentUser.set(response.user);
        })
      );
  }

  loadCurrentUser(): Observable<{ user: AuthUser }> {
    // קורא ל-/me כדי לוודא שה-token עדיין תקין ולקבל משתמש עדכני.
    return this.http.get<{ user: AuthUser }>(`${this.apiUrl}/me`).pipe(
      tap((response) => {
        localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(response.user));
        this.isSessionVerified = true;
        this.currentUser.set(response.user);
      })
    );
  }

  logout(): void {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(USER_STORAGE_KEY);
    this.isSessionVerified = false;
    this.currentUser.set(null);
  }

  getToken(): string | null {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  }

  isLoggedIn(): boolean {
    return Boolean(this.getToken() && this.currentUser());
  }

  validateSession(): Observable<boolean> {
    // ה-guard משתמש בזה כדי להחליט אם מותר להיכנס למסכים מוגנים.
    const token = this.getToken();

    if (!token) {
      // בלי token אין התחברות, אז מנקים מצב מקומי.
      this.logout();
      return of(false);
    }

    if (this.isSessionVerified && this.currentUser()) {
      // אם כבר אימתנו את הסשן, לא צריך לקרוא שוב לשרת.
      return of(true);
    }

    // אם יש token אבל עוד לא אומת, בודקים מול השרת.
    return this.loadCurrentUser().pipe(
      map(() => true),
      catchError(() => {
        this.logout();
        return of(false);
      })
    );
  }

  private readStoredUser(): AuthUser | null {
    const storedUser = localStorage.getItem(USER_STORAGE_KEY);

    if (!storedUser) {
      return null;
    }

    try {
      return JSON.parse(storedUser) as AuthUser;
    } catch {
      localStorage.removeItem(USER_STORAGE_KEY);
      return null;
    }
  }
}
