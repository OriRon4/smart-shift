import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';

import { AuthService } from './auth.service';

// ה-interceptor עובר על בקשות HTTP לפני שהן יוצאות לשרת.
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  // מקבלים גישה לשירות ההתחברות ולניווט.
  const authService = inject(AuthService);
  const router = inject(Router);
  // שולפים את ה-JWT שנשמר אחרי login.
  const token = authService.getToken();

  if (!token) {
    // אם אין token, הבקשה ממשיכה בלי Authorization.
    return next(request);
  }

  // אם יש token, משכפלים את הבקשה ומוסיפים Authorization.
  return next(
    request.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`
      }
    })
  ).pipe(
    // catchError מטפל בשגיאות שחוזרות מהשרת בתוך ה-Observable.
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401) {
        // 401 אומר שה-token חסר/לא תקין/פג תוקף.
        authService.logout();
        void router.navigate(['/login']);
      }

      // מחזירים את השגיאה הלאה לקומפוננטה שטיפלה בקריאה.
      return throwError(() => error);
    })
  );
};
