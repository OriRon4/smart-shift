import { Routes } from '@angular/router';

import { ScheduleBoardComponent } from './features/schedule/pages/schedule-board/schedule-board.component';

export const routes: Routes = [
  {
    path: 'schedule',
    component: ScheduleBoardComponent
  },
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'schedule'
  },
  {
    path: '**',
    redirectTo: 'schedule'
  }
];
