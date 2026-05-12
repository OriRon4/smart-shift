import { Component, EventEmitter, Input, Output } from '@angular/core';

import {
  ScheduleDay,
  JobRole,
  ScheduleBoardResponse,
  ScheduleRoleGroup,
  ScheduleShift,
  ScheduleWorker,
  ShiftRequirementsUpdate
} from '../../models/schedule.models';

type RoleGroupStatus = 'optimal' | 'covered' | 'understaffed' | 'plain';

export interface ReplaceAssignmentRequest {
  shiftId: number;
  dayName: string;
  date: string;
  shiftType: string;
  jobRole: JobRole;
  roleLabel: string;
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
  @Input() activeRoleGroupKeys = new Set<string>();
  @Input() onlyShowActive = false;
  @Input() canEditRequiredStrength = false;

  @Output() replaceAssignment = new EventEmitter<ReplaceAssignmentRequest>();
  @Output() removeAssignment = new EventEmitter<ReplaceAssignmentRequest>();
  @Output() updateRequiredStrength = new EventEmitter<{
    shiftId: number;
    requiredWaiters: number;
    requiredBartenders: number;
    requiredShiftLeaders: number;
    requiredStrengthScore: number;
  }>();

  protected selectedAssignmentKey: string | null = null;
  protected editingShiftId: number | null = null;
  protected requirementDrafts = new Map<number, ShiftRequirementsUpdate>();

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

  isRoleGroupHighlighted(shift: ScheduleShift, roleGroup: ScheduleRoleGroup): boolean {
    return this.activeRoleGroupKeys.has(`${shift.shiftId}:${roleGroup.jobRole}`);
  }

  getWorkerInitials(worker: ScheduleWorker): string {
    return worker.fullName
      .split(' ')
      .map((namePart) => namePart.charAt(0))
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }

  getShiftAssignedStrength(shift: ScheduleShift): number {
    return Number(
      shift.roleGroups
        .reduce(
          (total, roleGroup) => total + (roleGroup.assignedStrengthScore || 0),
          0
        )
        .toFixed(1)
    );
  }

  getRequiredStrengthDraft(shift: ScheduleShift): number {
    return this.getRequirementDraft(shift).requiredStrengthScore;
  }

  getRequirementDraft(shift: ScheduleShift): ShiftRequirementsUpdate {
    const existingDraft = this.requirementDrafts.get(shift.shiftId);

    if (existingDraft) {
      return existingDraft;
    }

    const draft = {
      shiftId: shift.shiftId,
      requiredWaiters: this.getRoleRequirement(shift, 'waiter'),
      requiredBartenders: this.getRoleRequirement(shift, 'bartender'),
      requiredShiftLeaders: this.getRoleRequirement(shift, 'shift_leader'),
      requiredStrengthScore: shift.requiredStrengthScore || 0,
    };

    this.requirementDrafts.set(shift.shiftId, draft);
    return draft;
  }

  updateRequirementDraft(
    shift: ScheduleShift,
    fieldName: keyof Omit<ShiftRequirementsUpdate, 'shiftId'>,
    event: Event
  ): void {
    const draft = this.getRequirementDraft(shift);
    this.requirementDrafts.set(shift.shiftId, {
      ...draft,
      [fieldName]: Number((event.target as HTMLInputElement).value),
    });
  }

  saveShiftRequirements(shift: ScheduleShift): void {
    const draft = this.getRequirementDraft(shift);

    if (
      draft.requiredWaiters < 1 ||
      draft.requiredBartenders < 0 ||
      draft.requiredShiftLeaders < 0 ||
      draft.requiredStrengthScore < 0 ||
      draft.requiredStrengthScore > 100
    ) {
      return;
    }

    this.updateRequiredStrength.emit(draft);
    this.editingShiftId = null;
  }

  openShiftRequirementEditor(shift: ScheduleShift): void {
    if (!this.canEditRequiredStrength) {
      return;
    }

    this.editingShiftId =
      this.editingShiftId === shift.shiftId ? null : shift.shiftId;
  }

  closeShiftRequirementEditor(): void {
    this.editingShiftId = null;
  }

  isShiftRequirementEditorOpen(shift: ScheduleShift): boolean {
    return this.editingShiftId === shift.shiftId;
  }

  selectAssignment(
    shift: ScheduleShift,
    roleGroup: ScheduleRoleGroup,
    worker: ScheduleWorker
  ): void {
    if (!this.canManage) {
      return;
    }

    const assignmentKey = this.getAssignmentKey(shift, roleGroup, worker);
    this.selectedAssignmentKey =
      this.selectedAssignmentKey === assignmentKey ? null : assignmentKey;
  }

  isAssignmentSelected(
    shift: ScheduleShift,
    roleGroup: ScheduleRoleGroup,
    worker: ScheduleWorker
  ): boolean {
    return this.selectedAssignmentKey === this.getAssignmentKey(shift, roleGroup, worker);
  }

  requestReplacement(
    day: ScheduleDay,
    shift: ScheduleShift,
    roleGroup: ScheduleRoleGroup,
    worker: ScheduleWorker
  ): void {
    this.replaceAssignment.emit({
      shiftId: shift.shiftId,
      dayName: day.dayName,
      date: day.date,
      shiftType: this.formatShiftType(shift),
      jobRole: roleGroup.jobRole,
      roleLabel: roleGroup.label,
      employeeId: worker.employeeId,
      employeeName: worker.fullName
    });
    this.selectedAssignmentKey = null;
  }

  requestRemoval(
    day: ScheduleDay,
    shift: ScheduleShift,
    roleGroup: ScheduleRoleGroup,
    worker: ScheduleWorker
  ): void {
    this.removeAssignment.emit({
      shiftId: shift.shiftId,
      dayName: day.dayName,
      date: day.date,
      shiftType: this.formatShiftType(shift),
      jobRole: roleGroup.jobRole,
      roleLabel: roleGroup.label,
      employeeId: worker.employeeId,
      employeeName: worker.fullName
    });
    this.selectedAssignmentKey = null;
  }

  private getRoleRequirement(shift: ScheduleShift, jobRole: JobRole): number {
    return (
      shift.roleGroups.find((roleGroup) => roleGroup.jobRole === jobRole)
        ?.requiredCount || 0
    );
  }

  private getAssignmentKey(
    shift: ScheduleShift,
    roleGroup: ScheduleRoleGroup,
    worker: ScheduleWorker
  ): string {
    return `${shift.shiftId}:${roleGroup.jobRole}:${worker.employeeId}`;
  }
}
