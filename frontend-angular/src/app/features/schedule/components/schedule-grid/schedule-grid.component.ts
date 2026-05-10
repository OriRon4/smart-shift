import { Component, EventEmitter, Input, Output } from '@angular/core';

import {
  JobRole,
  ScheduleBoardResponse,
  ScheduleRoleGroup,
  ScheduleShift,
  ScheduleWorker
} from '../../models/schedule.models';

type RoleGroupStatus = 'optimal' | 'covered' | 'understaffed' | 'plain';

export interface ReplaceAssignmentRequest {
  shiftId: number;
  jobRole: JobRole;
  employeeId: number;
  employeeName: string;
}

@Component({
  selector: 'app-schedule-grid',
  standalone: true,
  templateUrl: './schedule-grid.component.html',
  styleUrl: './schedule-grid.component.css'
})
export class ScheduleGridComponent {
  @Input({ required: true }) board: ScheduleBoardResponse | null = null;
  @Input() canManage = false;
  @Input() activeShiftIds = new Set<number>();
  @Input() onlyShowActive = false;

  @Output() replaceAssignment = new EventEmitter<ReplaceAssignmentRequest>();

  getRoleGroupStatus(roleGroup: ScheduleRoleGroup): RoleGroupStatus {
    if (roleGroup.uncoveredSlots === undefined) {
      return 'plain';
    }

    if (roleGroup.uncoveredSlots > 0) {
      return 'understaffed';
    }

    return roleGroup.meetsStrengthTarget ? 'optimal' : 'covered';
  }

  getRoleGroupStatusLabel(roleGroup: ScheduleRoleGroup): string {
    const status = this.getRoleGroupStatus(roleGroup);

    if (status === 'understaffed') {
      return 'Understaffed';
    }

    if (status === 'covered') {
      return 'Covered';
    }

    if (status === 'optimal') {
      return 'Optimal';
    }

    return `${roleGroup.assignedCount}/${roleGroup.requiredCount}`;
  }

  getRoleGroupClass(roleGroup: ScheduleRoleGroup): string {
    return `role-group--${roleGroup.jobRole.replace('_', '-')}`;
  }

  formatJobRole(jobRole: string): string {
    if (jobRole === 'shift_leader') {
      return 'Shift manager';
    }

    return jobRole.replace('_', ' ');
  }

  formatShiftType(shift: ScheduleShift): string {
    return shift.shiftType.charAt(0).toUpperCase() + shift.shiftType.slice(1);
  }

  shouldRenderShift(shift: ScheduleShift): boolean {
    return !this.onlyShowActive || this.activeShiftIds.has(shift.shiftId);
  }

  isShiftHighlighted(shift: ScheduleShift): boolean {
    return this.activeShiftIds.has(shift.shiftId);
  }

  getWorkerInitials(worker: ScheduleWorker): string {
    return worker.fullName
      .split(' ')
      .map((namePart) => namePart.charAt(0))
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }

  requestReplacement(
    shift: ScheduleShift,
    roleGroup: ScheduleRoleGroup,
    worker: ScheduleWorker
  ): void {
    this.replaceAssignment.emit({
      shiftId: shift.shiftId,
      jobRole: roleGroup.jobRole,
      employeeId: worker.employeeId,
      employeeName: worker.fullName
    });
  }
}
