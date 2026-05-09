import { Routes } from '@angular/router';

import { authGuard } from './core/auth/auth.guard';
import { AppLayoutComponent } from './core/layout/app-layout.component';
import { LoginComponent } from './features/auth/pages/login/login.component';
import { AvailabilityPageComponent } from './features/availability/pages/availability-page/availability-page.component';
import { DashboardPageComponent } from './features/dashboard/pages/dashboard-page/dashboard-page.component';
import { EmployeesPageComponent } from './features/employees/pages/employees-page/employees-page.component';
import { ScheduleBoardComponent } from './features/schedule/pages/schedule-board/schedule-board.component';

export const routes: Routes = [
  {
    path: 'login',
    component: LoginComponent
  },
  {
    path: '',
    component: AppLayoutComponent,
    canActivate: [authGuard],
    children: [
      {
        path: 'dashboard',
        component: DashboardPageComponent
      },
      {
        path: 'schedule',
        component: ScheduleBoardComponent
      },
      {
        path: 'employees',
        component: EmployeesPageComponent
      },
      {
        path: 'availability',
        component: AvailabilityPageComponent
      },
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'dashboard'
      }
    ]
  },
  {
    path: '**',
    redirectTo: 'dashboard'
  }
];
