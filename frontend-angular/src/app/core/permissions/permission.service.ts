import { Injectable } from '@angular/core';

import { AuthUser } from '../auth/auth.models';

@Injectable({
  providedIn: 'root'
})
export class PermissionService {
  isManager(user: AuthUser | null): boolean {
    return user?.permissionRole === 'manager';
  }

  isShiftLeader(user: AuthUser | null): boolean {
    return user?.permissionRole === 'shift_leader';
  }

  canViewEmployeeDetails(user: AuthUser | null): boolean {
    return this.isManager(user) || this.isShiftLeader(user);
  }

  canEditEmployees(user: AuthUser | null): boolean {
    return this.isManager(user);
  }

  canManageSchedule(user: AuthUser | null): boolean {
    return this.isManager(user);
  }

  canReplaceScheduleWorkers(user: AuthUser | null): boolean {
    return this.isManager(user) || this.isShiftLeader(user);
  }

  canSaveScheduleAssignments(user: AuthUser | null): boolean {
    return this.canReplaceScheduleWorkers(user);
  }

  canUseLimitedScheduleEditing(user: AuthUser | null): boolean {
    return this.isManager(user) || this.isShiftLeader(user);
  }
}
