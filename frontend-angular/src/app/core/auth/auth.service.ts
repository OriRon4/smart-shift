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
  private readonly apiUrl = `${environment.apiBaseUrl}/auth`;
  private isSessionVerified = false;
  readonly currentUser = signal<AuthUser | null>(this.readStoredUser());

  constructor(private readonly http: HttpClient) {}

  login(login: string, password: string): Observable<LoginResponse> {
    return this.http
      .post<LoginResponse>(`${this.apiUrl}/login`, {
        login,
        password
      })
      .pipe(
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
    const token = this.getToken();

    if (!token) {
      this.logout();
      return of(false);
    }

    if (this.isSessionVerified && this.currentUser()) {
      return of(true);
    }

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
