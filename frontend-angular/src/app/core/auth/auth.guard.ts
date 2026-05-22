import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';

import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.validateSession().pipe(
    map((isValidSession) => {
      if (isValidSession) {
        return true;
      }

      return router.createUrlTree(['/login']);
    })
  );
};
