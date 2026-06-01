import { Component, OnDestroy, OnInit } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';

import {
  ReplaceAssignmentRequest,
  ScheduleGridComponent
} from '../../components/schedule-grid/schedule-grid.component';
import { WeekSelectorComponent } from '../../components/week-selector/week-selector.component';
import {
  JobRole,
  FinishShiftFeedback,
  ShiftMlPrediction,
  SaveScheduleAssignment,
  ScheduleAssignmentIssue,
  ScheduleBoardResponse,
  ScheduleCoverageIssue,
  ScheduleFairnessWarning,
  ScheduleRoleGroup,
  ScheduleShift,
  ScheduleStrengthIssue,
  ScheduleValidationIssue,
  ScheduleValidationResponse,
  ScheduleWorker,
  ShiftRequirementsUpdate
} from '../../models/schedule.models';
import { ScheduleApiService } from '../../services/schedule-api.service';
import { MlRecommendationsApiService } from '../../services/ml-recommendations-api.service';
import { AuthService } from '../../../../core/auth/auth.service';
import { PermissionService } from '../../../../core/permissions/permission.service';
import { Employee } from '../../../employees/models/employee.models';
import { EmployeesApiService } from '../../../employees/services/employees-api.service';
import { AvailabilityApiService } from '../../../availability/services/availability-api.service';
import {
  addDaysToDateKey,
  getCurrentWeekStartDate
} from '../../../../shared/date/week-date.util';

@Component({
  selector: 'app-schedule-board',
  standalone: true,
  imports: [
    ScheduleGridComponent,
    WeekSelectorComponent
  ],
  templateUrl: './schedule-board.component.html',
  styleUrl: './schedule-board.component.css'
})
export class ScheduleBoardComponent implements OnDestroy, OnInit {
  // השבוע שעליו עובדים כרגע. הערך הזה נשלח לשרת ביצירת סידור.
  protected selectedWeekStartDate = getCurrentWeekStartDate();
  // זה ה-board שהתצוגה משתמשת בו כדי להציג את הסידור.
  protected board: ScheduleBoardResponse | null = null;
  protected employees: Employee[] = [];
  protected availableShiftIdsByEmployeeId = new Map<number, Set<number>>();
  protected pendingReplacement: ReplaceAssignmentRequest | null = null;
  protected replacementSearch = '';
  // תוצאת בדיקת הסידור האחרונה, אם הופעלה. מאופסת ביצירת סידור חדש.
  protected validationResult: ScheduleValidationResponse | null = null;
  protected isValidationDialogOpen = false;
  protected isBlockingIssuesExpanded = false;
  protected isStrengthWarningsExpanded = false;
  protected isFairnessWarningsExpanded = false;
  protected isMlApplyDialogOpen = false;
  protected pendingFinishShift: {
    shift: ScheduleShift;
    dayName: string;
    date: string;
  } | null = null;
  protected finishShiftFeedback: FinishShiftFeedback = this.createDefaultFinishShiftFeedback();
  // מצבי מסך: טעינה, שגיאה כללית, שגיאת פעולה והודעת הצלחה.
  protected isLoading = false;
  protected errorMessage = '';
  protected actionErrorMessage = '';
  protected successMessage = '';
  protected boardFilter: 'all' | 'gaps' | 'strength' = 'all';
  protected focusedShiftId: number | null = null;
  protected hasUnsavedChanges = false;
  protected showEmployeesUnderTarget = false;
  protected mlPredictionsByShiftId = new Map<number, ShiftMlPrediction>();

  protected readonly currentUser = this.authService.currentUser;

  constructor(
    private readonly scheduleApiService: ScheduleApiService,
    private readonly mlRecommendationsApiService: MlRecommendationsApiService,
    private readonly authService: AuthService,
    private readonly permissionService: PermissionService,
    private readonly employeesApiService: EmployeesApiService,
    private readonly availabilityApiService: AvailabilityApiService
  ) {}

  ngOnInit(): void {
    this.loadSchedule();

    if (this.canReplaceScheduleWorkers()) {
      this.employeesApiService.getEmployees().subscribe({
        next: (response) => {
          this.employees = response.employees;
        }
      });
      this.loadReplacementAvailability();
    }

    if (this.canManageSchedule()) {
      this.loadMlPredictions();
    }
  }

  ngOnDestroy(): void {
    this.closeReplacementDrawer();
  }

  protected get weekRangeLabel(): string {
    return `${this.formatDisplayDate(this.selectedWeekStartDate)} - ${this.formatDisplayDate(
      this.addDays(this.selectedWeekStartDate, 6)
    )}`;
  }

  protected canManageSchedule(): boolean {
    return this.permissionService.canManageSchedule(this.currentUser());
  }

  protected canReplaceScheduleWorkers(): boolean {
    return this.permissionService.canReplaceScheduleWorkers(this.currentUser());
  }

  protected canSaveScheduleAssignments(): boolean {
    return this.permissionService.canSaveScheduleAssignments(this.currentUser());
  }

  protected get totalAssignedEmployees(): number {
    if (!this.board) {
      return 0;
    }

    return this.board.days.reduce(
      (total, day) =>
        total +
        day.shifts.reduce(
          (shiftTotal, shift) =>
            shiftTotal +
            shift.roleGroups.reduce(
              (roleTotal, roleGroup) => roleTotal + roleGroup.assignedCount,
              0
            ),
          0
        ),
      0
    );
  }

  protected get unfilledSlots(): number {
    if (!this.board) {
      return 0;
    }

    return this.board.days.reduce(
      (total, day) =>
        total +
        day.shifts.reduce(
          (shiftTotal, shift) =>
            shiftTotal +
            shift.roleGroups.reduce(
              (roleTotal, roleGroup) => roleTotal + (roleGroup.uncoveredSlots || 0),
              0
            ),
          0
        ),
      0
    );
  }

  protected get coveragePercent(): number {
    const required = this.board?.summary?.totalRoleRequirements || 0;

    if (!required) {
      return 0;
    }

    return Math.round((this.totalAssignedEmployees / required) * 100);
  }

  protected get strengthRiskGroups(): number {
    return this.board?.summary?.belowStrengthTargetRoleGroups || 0;
  }

  protected get gapRoleGroupCount(): number {
    if (!this.board) {
      return 0;
    }

    return this.board.days.reduce(
      (total, day) =>
        total +
        day.shifts.reduce(
          (shiftTotal, shift) =>
            shiftTotal +
            shift.roleGroups.filter(
              (roleGroup) => (roleGroup.uncoveredSlots || 0) > 0
            ).length,
          0
        ),
      0
    );
  }

  protected get gapShiftCount(): number {
    if (!this.board) {
      return 0;
    }

    return this.board.days.reduce(
      (total, day) =>
        total +
        day.shifts.filter((shift) =>
          shift.roleGroups.some(
            (roleGroup) => (roleGroup.uncoveredSlots || 0) > 0
          )
        ).length,
      0
    );
  }

  protected get belowStrengthShiftCount(): number {
    if (!this.board) {
      return 0;
    }

    return this.board.days.reduce(
      (total, day) =>
        total +
        day.shifts.filter((shift) =>
          shift.roleGroups.some((roleGroup) =>
            this.isRoleGroupBelowStrength(roleGroup)
          )
        ).length,
      0
    );
  }

  protected get scheduleStatusValue(): string {
    if (!this.board) {
      return 'Not generated';
    }

    if (this.hasUnsavedChanges) {
      return 'Unsaved changes';
    }

    if (this.totalAssignedEmployees === 0) {
      return 'Empty';
    }

    if (this.validationResult && this.validationResult.warnings.length === 0) {
      return 'Validated';
    }

    if (this.validationResult?.warnings.length || this.unfilledSlots > 0 || this.belowStrengthShiftCount > 0) {
      return 'Needs review';
    }

    if (this.board.scheduleId) {
      return 'Saved';
    }

    return 'Draft';
  }

  protected get scheduleStatusTone(): string {
    if (!this.board) {
      return 'neutral';
    }

    if (this.unfilledSlots > 0) {
      return 'critical';
    }

    if (this.belowStrengthShiftCount > 0) {
      return 'warning';
    }

    return 'good';
  }

  protected get scheduleStatusHelper(): string {
    if (!this.board) {
      return 'No schedule generated yet';
    }

    if (this.hasUnsavedChanges) {
      return 'Save changes to persist replacements';
    }

    if (this.totalAssignedEmployees === 0) {
      return 'No assignments in this schedule';
    }

    if (this.validationResult) {
      return `${this.validationResult.warnings.length} validation warnings`;
    }

    const attentionCount = this.getProblemShiftIds('gaps').size;

    if (attentionCount > 0) {
      return `${attentionCount} shifts need attention`;
    }

    return 'All required slots are filled';
  }

  protected get weakestShift(): {
    label: string;
    helper: string;
    gap: number;
  } | null {
    if (!this.board) {
      return null;
    }

    const candidates = this.board.days.flatMap((day) =>
      day.shifts.flatMap((shift) =>
        shift.roleGroups.map((roleGroup) => {
          const assignedStrength = roleGroup.assignedStrengthScore || 0;
          const requiredStrength = roleGroup.requiredStrengthScore || 0;

          return {
            label: `${day.dayName} ${this.formatShiftType(shift)}`,
            helper: `${Number(assignedStrength.toFixed(1))} / ${Number(
              requiredStrength.toFixed(1)
            )} strength`,
            gap: Math.max(0, requiredStrength - assignedStrength),
          };
        })
      )
    );

    return (
      candidates
        .filter((candidate) => candidate.gap > 0)
        .sort((left, right) => right.gap - left.gap)[0] || null
    );
  }

  protected get employeesUnderTarget(): {
    employeeId: number;
    fullName: string;
    assigned: number;
    requested: number;
    target: number;
    gap: number;
  }[] {
    const assignedCounts = this.getAssignedCountsByEmployee();

    return this.employees
      .filter((employee) => employee.isActive !== false)
      .map((employee) => {
        const assigned = assignedCounts.get(employee.id) || 0;
        const requested = this.getRequestedShiftCount(employee.id);
        const target = this.calculateTargetShifts(employee, requested);

        return {
          employeeId: employee.id,
          fullName: employee.fullName,
          assigned,
          requested,
          target,
          gap: Number((assigned - target).toFixed(1)),
        };
      })
      .filter((employee) => employee.requested > 0 && employee.assigned < employee.target - 0.5)
      .sort((left, right) => left.gap - right.gap || left.fullName.localeCompare(right.fullName));
  }

  protected toggleEmployeesUnderTarget(): void {
    this.showEmployeesUnderTarget = !this.showEmployeesUnderTarget;
  }

  protected get publishedStatusLabel(): string {
    if (!this.board?.publishedAt) {
      return 'Not published yet';
    }

    return 'Published';
  }

  protected get publishButtonLabel(): string {
    return this.board?.publishedAt ? 'Unpublish Schedule' : 'Publish Schedule';
  }

  protected get isScheduleHiddenForViewer(): boolean {
    return Boolean(
      this.board?.scheduleId &&
        !this.board.publishedAt &&
        !this.canManageSchedule()
    );
  }

  protected get canUseScheduleActions(): boolean {
    return !this.isScheduleHiddenForViewer;
  }

  protected get openIssueCount(): number {
    return this.unfilledSlots + this.belowStrengthShiftCount;
  }

  protected get openIssuesHelper(): string {
    if (!this.openIssueCount) {
      return 'No critical issues';
    }

    const parts: string[] = [];

    if (this.unfilledSlots) {
      parts.push(`${this.unfilledSlots} unfilled slot${this.unfilledSlots === 1 ? '' : 's'}`);
    }

    if (this.belowStrengthShiftCount) {
      parts.push(`${this.belowStrengthShiftCount} below strength`);
    }

    return parts.join(', ');
  }

  protected get coverageQualityHelper(): string {
    const required = this.board?.summary?.totalRoleRequirements || 0;
    return `${this.totalAssignedEmployees} of ${required} required assignments filled`;
  }

  protected get strengthRiskValue(): string {
    if (this.belowStrengthShiftCount === 0) {
      return 'Low';
    }

    if (this.belowStrengthShiftCount <= 3) {
      return 'Medium';
    }

    return 'High';
  }

  protected get strengthRiskTone(): string {
    if (this.belowStrengthShiftCount === 0) {
      return 'good';
    }

    if (this.belowStrengthShiftCount <= 3) {
      return 'warning';
    }

    return 'critical';
  }

  protected get strengthRiskHelper(): string {
    if (!this.belowStrengthShiftCount) {
      return 'All shifts meet strength target';
    }

    return `${this.belowStrengthShiftCount} shifts below required strength`;
  }

  protected get fairnessGap(): number {
    const assignedCounts = this.getAssignedCountsByEmployee();
    const counts = [...assignedCounts.values()];

    if (!counts.length) {
      return 0;
    }

    return Math.max(...counts) - Math.min(...counts);
  }

  protected get fairnessBalanceValue(): string {
    if (this.fairnessGap <= 1) {
      return 'Balanced';
    }

    if (this.fairnessGap <= 2) {
      return 'Slightly uneven';
    }

    return 'Uneven';
  }

  protected get fairnessBalanceTone(): string {
    if (this.fairnessGap <= 1) {
      return 'good';
    }

    if (this.fairnessGap <= 2) {
      return 'warning';
    }

    return 'critical';
  }

  protected get fairnessBalanceHelper(): string {
    if (!this.board) {
      return 'No assignments yet';
    }

    if (this.fairnessGap <= 1) {
      return 'Assignments are balanced';
    }

    return `Max gap: ${this.fairnessGap} shifts between employees`;
  }

  protected get mostCriticalShiftValue(): string {
    const criticalShift = this.mostCriticalShift;
    return criticalShift?.label || 'No critical shifts';
  }

  protected get mostCriticalShiftHelper(): string {
    const criticalShift = this.mostCriticalShift;
    return criticalShift?.helper || 'All shifts look good';
  }

  protected get mostCriticalShiftTone(): string {
    const criticalShift = this.mostCriticalShift;

    if (!criticalShift) {
      return 'good';
    }

    return criticalShift.unfilledSlots > 0 ? 'critical' : 'warning';
  }

  protected get mostCriticalShift(): {
    shiftId: number;
    label: string;
    helper: string;
    unfilledSlots: number;
    strengthGap: number;
  } | null {
    if (!this.board) {
      return null;
    }

    const candidates = this.board.days.flatMap((day) =>
      day.shifts.map((shift) => {
        const unfilledSlots = shift.roleGroups.reduce(
          (total, roleGroup) => total + (roleGroup.uncoveredSlots || 0),
          0
        );
        const strengthGap = shift.roleGroups.reduce(
          (maxGap, roleGroup) =>
            Math.max(
              maxGap,
              Math.max(
                0,
                (roleGroup.requiredStrengthScore || 0) -
                  (roleGroup.assignedStrengthScore || 0)
              )
            ),
          0
        );

        return {
          shiftId: shift.shiftId,
          label: `${day.dayName} ${this.formatShiftType(shift)}`,
          helper:
            unfilledSlots > 0
              ? `${unfilledSlots} missing assignment${unfilledSlots === 1 ? '' : 's'}`
              : `Strength gap: ${Number(strengthGap.toFixed(1))}`,
          unfilledSlots,
          strengthGap,
        };
      })
    );

    const missingAssignments = candidates
      .filter((candidate) => candidate.unfilledSlots > 0)
      .sort((left, right) => right.unfilledSlots - left.unfilledSlots);

    if (missingAssignments.length) {
      return missingAssignments[0];
    }

    const strengthRisks = candidates
      .filter((candidate) => candidate.strengthGap > 0)
      .sort((left, right) => right.strengthGap - left.strengthGap);

    return strengthRisks[0] || null;
  }

  protected setBoardFilter(filter: 'all' | 'gaps' | 'strength'): void {
    this.boardFilter = this.boardFilter === filter ? 'all' : filter;
    this.focusedShiftId = null;
  }

  protected focusMostCriticalShift(): void {
    const criticalShift = this.mostCriticalShift;

    if (!criticalShift) {
      this.boardFilter = 'all';
      this.focusedShiftId = null;
      return;
    }

    this.boardFilter = 'all';
    this.focusedShiftId = criticalShift.shiftId;
  }

  protected get activeShiftIds(): Set<number> {
    if (this.focusedShiftId) {
      return new Set([this.focusedShiftId]);
    }

    if (this.boardFilter === 'gaps') {
      return this.getProblemShiftIds('gaps');
    }

    if (this.boardFilter === 'strength') {
      return this.getProblemShiftIds('strength');
    }

    return new Set<number>();
  }

  protected get activeRoleGroupKeys(): Set<string> {
    if (this.boardFilter === 'gaps') {
      return this.getProblemRoleGroupKeys('gaps');
    }

    if (this.boardFilter === 'strength') {
      return this.getProblemRoleGroupKeys('strength');
    }

    return new Set<string>();
  }

  protected previousWeek(): void {
    this.changeSelectedWeek(-7);
  }

  protected nextWeek(): void {
    this.changeSelectedWeek(7);
  }

  protected loadSchedule(): void {
    // טוען סידור קיים לשבוע שנבחר בלי ליצור סידור חדש.
    this.isLoading = true;
    this.errorMessage = '';
    this.actionErrorMessage = '';
    this.successMessage = '';
    // תוצאת בדיקה קודמת כבר לא רלוונטית אחרי טעינת שבוע/סידור אחר.
    this.validationResult = null;
    this.isValidationDialogOpen = false;
    this.resetValidationExpansion();
    this.pendingReplacement = null;
    this.hasUnsavedChanges = false;
    this.showEmployeesUnderTarget = false;

    // GET לשרת לפי selectedWeekStartDate; התצוגה משתמשת ב-this.board.
    this.scheduleApiService.getSchedule(this.selectedWeekStartDate).subscribe({
      next: (board) => {
        // אם אין סידור ואין ימים להצגה, משאירים board ריק.
        this.board = board.scheduleId || board.days.length ? board : null;
        this.isLoading = false;
      },
      error: (error: unknown) => {
        this.errorMessage = this.resolveErrorMessage(error);
        this.isLoading = false;
      }
    });
  }


  // מופעל כשהאבא מקבל אירוע generateSchedule מה-week-selector.
  protected generateSchedule(): void {
    // מנקים מצב קודם ומפעילים טעינה לפני הקריאה לשרת.
    this.isLoading = true;
    this.errorMessage = '';
    this.actionErrorMessage = '';
    this.successMessage = '';
    // מאופס ביצירת סידור חדש כי תוצאת בדיקה קודמת כבר לא רלוונטית.
    this.validationResult = null;

    // קוראים ל-API עם השבוע הנבחר בלבד.
    this.scheduleApiService
      .generateSchedule(this.selectedWeekStartDate)
      .subscribe({
        // בהצלחה: שומרים את ה-board שחזר מהשרת לתצוגה.
        next: (board) => {
          this.board = board;
          this.successMessage = 'Schedule generated.';
          this.hasUnsavedChanges = false;
          this.showEmployeesUnderTarget = false;
          this.isLoading = false;
        },
        // בשגיאה: שומרים הודעה שהמסך יציג למשתמש.
        error: (error: unknown) => {
          this.errorMessage = this.resolveErrorMessage(error);
          this.isLoading = false;
        }
      });
  }


  protected openReplacement(request: ReplaceAssignmentRequest): void {
    if (!this.canReplaceScheduleWorkers()) {
      return;
    }

    this.pendingReplacement = request;
    this.replacementSearch = '';
  }

  protected generateMlRecommendations(): void {
    if (!this.canManageSchedule()) {
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    this.actionErrorMessage = '';
    this.successMessage = '';

    this.mlRecommendationsApiService
      .generateWeekPredictions(this.selectedWeekStartDate)
      .subscribe({
        next: (response) => {
          this.setMlPredictions(response.predictions);
          this.successMessage = 'ML recommendations generated.';
          this.isMlApplyDialogOpen = true;
          this.isLoading = false;
        },
        error: (error: unknown) => {
          this.errorMessage = this.resolveErrorMessage(error);
          this.isLoading = false;
        }
      });
  }

  protected applyAllMlRecommendations(): void {
    if (!this.canManageSchedule()) {
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    this.actionErrorMessage = '';
    this.successMessage = '';

    this.mlRecommendationsApiService
      .applyWeekPredictions(this.selectedWeekStartDate)
      .subscribe({
        next: () => {
          this.isMlApplyDialogOpen = false;
          this.reloadCurrentScheduleAfterAction('All ML recommendations applied and saved.');
          this.loadMlPredictions();
          this.isLoading = false;
        },
        error: (error: unknown) => {
          this.actionErrorMessage = this.resolveErrorMessage(error);
          this.isLoading = false;
        }
      });
  }

  protected keepCurrentRequirements(): void {
    this.isMlApplyDialogOpen = false;
    this.successMessage = 'ML recommendations generated. Current shift requirements kept.';
  }

  protected closeReplacementDrawer(): void {
    this.pendingReplacement = null;
    this.replacementSearch = '';
  }

  protected getReplacementCandidates(): Employee[] {
    const searchValue = this.replacementSearch.trim().toLowerCase();

    return this.employees
      .filter((employee) => employee.isActive !== false)
      .filter((employee) => employee.id !== this.pendingReplacement?.employeeId)
      .filter((employee) =>
        searchValue
          ? employee.fullName.toLowerCase().includes(searchValue)
          : true
      )
      .sort((leftEmployee, rightEmployee) =>
        this.compareReplacementCandidates(leftEmployee, rightEmployee)
      );
  }

  protected getReplacementCandidateSections(): {
    title: string;
    employees: Employee[];
  }[] {
    const candidates = this.getReplacementCandidates();
    const sameRoleEmployees = candidates.filter(
      (employee) => employee.jobRole === this.pendingReplacement?.jobRole
    );
    const otherRoleEmployees = candidates.filter(
      (employee) => employee.jobRole !== this.pendingReplacement?.jobRole
    );

    return [
      {
        title: 'Same role',
        employees: sameRoleEmployees,
      },
      {
        title: 'Other roles',
        employees: otherRoleEmployees,
      },
    ].filter((section) => section.employees.length > 0);
  }

  protected updateReplacementSearch(event: Event): void {
    this.replacementSearch = (event.target as HTMLInputElement).value;
  }

  protected applyReplacement(employeeId: number): void {
    if (!this.board || !this.pendingReplacement) {
      return;
    }

    const replacementEmployee = this.employees.find(
      (employee) => employee.id === Number(employeeId)
    );

    if (!replacementEmployee) {
      return;
    }

    if (replacementEmployee.isActive === false) {
      this.actionErrorMessage = 'Inactive employees cannot be selected for replacement.';
      return;
    }

    if (this.isEmployeeScheduledForPendingShift(replacementEmployee)) {
      this.actionErrorMessage = 'This employee is already scheduled for this shift.';
      return;
    }

    for (const day of this.board.days) {
      for (const shift of day.shifts) {
        if (shift.shiftId !== this.pendingReplacement.shiftId) {
          continue;
        }

        const roleGroup = shift.roleGroups.find(
          (group) => group.jobRole === this.pendingReplacement?.jobRole
        );
        if (!roleGroup) {
          continue;
        }

        const replacementWorker = this.buildScheduleWorker(replacementEmployee);

        if (this.pendingReplacement.mode === 'add') {
          roleGroup.assignedWorkers = [...roleGroup.assignedWorkers, replacementWorker];
          this.refreshRoleGroupMetrics(roleGroup);
          continue;
        }

        const worker = roleGroup.assignedWorkers.find(
          (assignedWorker) =>
            assignedWorker.employeeId === this.pendingReplacement?.employeeId
        );

        if (worker) {
          Object.assign(worker, replacementWorker);
          this.refreshRoleGroupMetrics(roleGroup);
        }
      }
    }

    this.successMessage =
      this.pendingReplacement.mode === 'add'
        ? 'Worker added. Save changes to persist it.'
        : 'Replacement staged. Save changes to persist it.';
    this.actionErrorMessage = '';
    this.hasUnsavedChanges = true;
    this.validationResult = null;
    this.isValidationDialogOpen = false;
    this.closeReplacementDrawer();
  }

  protected removeAssignment(request: ReplaceAssignmentRequest): void {
    if (!this.board || !this.canReplaceScheduleWorkers()) {
      return;
    }

    const confirmed = window.confirm('Remove this worker from the shift?');

    if (!confirmed) {
      return;
    }

    for (const day of this.board.days) {
      for (const shift of day.shifts) {
        if (shift.shiftId !== request.shiftId) {
          continue;
        }

        const roleGroup = shift.roleGroups.find(
          (group) => group.jobRole === request.jobRole
        );

        if (!roleGroup) {
          continue;
        }

        roleGroup.assignedWorkers = roleGroup.assignedWorkers.filter(
          (worker) => worker.employeeId !== request.employeeId
        );
        this.refreshRoleGroupMetrics(roleGroup);
      }
    }

    this.successMessage = 'Assignment removed. Save changes to persist it.';
    this.actionErrorMessage = '';
    this.hasUnsavedChanges = true;
    this.validationResult = null;
  }

  protected getEmployeeInitials(employee: Employee): string {
    return employee.fullName
      .split(' ')
      .map((namePart) => namePart.charAt(0))
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }

  protected formatEmployeeRole(employee: Employee): string {
    return this.formatJobRole(employee.jobRole || 'employee');
  }

  protected getEmployeeShiftRatio(employee: Employee): string {
    return `${this.getAssignedShiftCount(employee.id)}/${this.getRequestedShiftCount(employee.id)}`;
  }

  protected isEmployeeAvailableForPendingShift(employee: Employee): boolean {
    if (!this.pendingReplacement) {
      return false;
    }

    return (
      this.availableShiftIdsByEmployeeId
        .get(employee.id)
        ?.has(this.pendingReplacement.shiftId) || false
    );
  }

  protected isEmployeeScheduledForPendingShift(employee: Employee): boolean {
    if (!this.board || !this.pendingReplacement) {
      return false;
    }

    return this.board.days.some((day) =>
      day.shifts.some(
        (shift) =>
          shift.shiftId === this.pendingReplacement?.shiftId &&
          shift.roleGroups.some((roleGroup) =>
            roleGroup.assignedWorkers.some(
              (worker) => worker.employeeId === employee.id
            )
          )
      )
    );
  }

  protected isEmployeeWorkingSameDay(employee: Employee): boolean {
    if (!this.board || !this.pendingReplacement) {
      return false;
    }

    return this.board.days.some(
      (day) =>
        day.date === this.pendingReplacement?.date &&
        day.shifts.some((shift) =>
          shift.roleGroups.some((roleGroup) =>
            roleGroup.assignedWorkers.some(
              (worker) => worker.employeeId === employee.id
            )
          )
        )
    );
  }

  protected getEmployeeTargetRatio(employee: Employee): string {
    const assigned = this.getAssignedShiftCount(employee.id);
    const requested = this.getRequestedShiftCount(employee.id);
    const target = this.calculateTargetShifts(employee, requested);

    return `${assigned}/${target}`;
  }

  protected getReplacementMatchScore(employee: Employee): number {
    const roleScore = employee.jobRole === this.pendingReplacement?.jobRole ? 3 : 0;
    const availabilityScore = this.isEmployeeAvailableForPendingShift(employee) ? 2 : 0;
    const workloadScore = Math.min(2, this.getReplacementWorkloadGap(employee));
    const strengthScore = Math.min(3, this.calculateEmployeeStrength(employee) / 10 * 3);

    return Math.max(
      1,
      Math.min(10, Math.round(roleScore + availabilityScore + workloadScore + strengthScore))
    );
  }

  private compareReplacementCandidates(
    leftEmployee: Employee,
    rightEmployee: Employee
  ): number {
    const leftScheduled = this.isEmployeeScheduledForPendingShift(leftEmployee);
    const rightScheduled = this.isEmployeeScheduledForPendingShift(rightEmployee);

    if (leftScheduled !== rightScheduled) {
      return leftScheduled ? 1 : -1;
    }

    const leftAvailable = this.isEmployeeAvailableForPendingShift(leftEmployee);
    const rightAvailable = this.isEmployeeAvailableForPendingShift(rightEmployee);

    if (leftAvailable !== rightAvailable) {
      return leftAvailable ? -1 : 1;
    }

    const scoreGap =
      this.getReplacementMatchScore(rightEmployee) -
      this.getReplacementMatchScore(leftEmployee);

    if (scoreGap !== 0) {
      return scoreGap;
    }

    return leftEmployee.fullName.localeCompare(rightEmployee.fullName);
  }

  private getReplacementWorkloadGap(employee: Employee): number {
    const assigned = this.getAssignedShiftCount(employee.id);
    const requested = this.getRequestedShiftCount(employee.id);
    const target = this.calculateTargetShifts(employee, requested);

    return Math.max(0, target - assigned);
  }

  private buildScheduleWorker(employee: Employee): ScheduleWorker {
    const requestedShiftCount = this.getRequestedShiftCount(employee.id);

    return {
      employeeId: employee.id,
      fullName: employee.fullName,
      jobRole: employee.jobRole as JobRole,
      strengthScore: Number(this.calculateEmployeeStrength(employee).toFixed(1)),
      assignedShiftCount: this.getAssignedShiftCount(employee.id) + 1,
      requestedShiftCount,
      targetShiftCount: this.calculateTargetShifts(employee, requestedShiftCount),
    };
  }

  protected saveChanges(overrideWarnings = false): void {
    if (!this.board?.scheduleId || !this.canSaveScheduleAssignments()) {
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    this.successMessage = '';

    this.scheduleApiService
      .saveAssignments(
        this.board.scheduleId,
        this.selectedWeekStartDate,
        this.flattenAssignments(this.board),
        overrideWarnings
      )
      .subscribe({
        next: (board) => {
          this.board = board;
          this.successMessage = overrideWarnings
            ? 'Schedule changes saved with manager override.'
            : 'Schedule changes saved.';
          this.hasUnsavedChanges = false;
          this.isLoading = false;
        },
        error: (error: unknown) => {
          if (this.canManageSchedule() && this.isAssignmentWarningError(error)) {
            const confirmed = window.confirm(
              'Assignments include warnings. Save anyway with manager override?'
            );

            if (confirmed) {
              this.isLoading = false;
              this.saveChanges(true);
              return;
            }
          }

          this.errorMessage = this.resolveErrorMessage(error);
          this.isLoading = false;
        }
      });
  }

  protected validateSchedule(): void {
    if (!this.board?.scheduleId) {
      return;
    }

    // בדיקת סידור קיימת: שולחים לשרת את השיבוצים שמופיעים כרגע במסך.
    this.isLoading = true;
    this.errorMessage = '';
    this.successMessage = '';

    this.scheduleApiService
      .validateSchedule(
        this.board.scheduleId,
        this.selectedWeekStartDate,
        // flattenAssignments הופך את ה-board לרשימת assignment פשוטה לשרת.
        this.flattenAssignments(this.board),
        this.hasUnsavedChanges
      )
      .subscribe({
        // התוצאה נשמרת ונפתחת בתיבת בדיקה במסך.
        next: (result) => {
          this.validationResult = result;
          this.isValidationDialogOpen = true;
          this.resetValidationExpansion();
          this.isLoading = false;
        },
        error: (error: unknown) => {
          this.errorMessage = this.resolveErrorMessage(error);
          this.isLoading = false;
        }
      });
  }

  protected closeValidationDialog(): void {
    this.isValidationDialogOpen = false;
  }

  private resetValidationExpansion(): void {
    this.isBlockingIssuesExpanded = false;
    this.isStrengthWarningsExpanded = false;
    this.isFairnessWarningsExpanded = false;
  }

  protected openFinishShiftDialog(shift: ScheduleShift): void {
    if (!this.canReplaceScheduleWorkers() || shift.hasPerformanceFeedback) {
      return;
    }

    const day = this.findDayForShift(shift.shiftId);

    if (!day) {
      return;
    }

    this.pendingFinishShift = {
      shift,
      dayName: day.dayName,
      date: day.date,
    };
    this.finishShiftFeedback = this.createDefaultFinishShiftFeedback();
    this.actionErrorMessage = '';
  }

  protected closeFinishShiftDialog(): void {
    this.pendingFinishShift = null;
    this.finishShiftFeedback = this.createDefaultFinishShiftFeedback();
  }

  protected updateFinishShiftFeedback(
    fieldName: keyof FinishShiftFeedback,
    value: FinishShiftFeedback[keyof FinishShiftFeedback] | Event
  ): void {
    const nextValue =
      value instanceof Event
        ? this.readPositiveNumberInput(value)
        : value;

    this.finishShiftFeedback = {
      ...this.finishShiftFeedback,
      [fieldName]: nextValue,
    };
  }

  protected submitFinishShiftFeedback(): void {
    if (!this.pendingFinishShift) {
      return;
    }

    if (
      !this.finishShiftFeedback.actualCustomers ||
      this.finishShiftFeedback.actualCustomers <= 0 ||
      !this.finishShiftFeedback.actualWaitersNeeded ||
      this.finishShiftFeedback.actualWaitersNeeded <= 0 ||
      !this.finishShiftFeedback.managerRating ||
      this.finishShiftFeedback.managerRating < 1 ||
      this.finishShiftFeedback.managerRating > 5
    ) {
      this.actionErrorMessage =
        'Enter actual customers, waiters needed, and manager rating.';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    this.actionErrorMessage = '';
    this.successMessage = '';

    this.scheduleApiService
      .finishShift(this.pendingFinishShift.shift.shiftId, this.finishShiftFeedback)
      .subscribe({
        next: (board) => {
          if (this.isUsableScheduleBoard(board)) {
            this.board = board;
          }

          this.successMessage =
            board.message ||
            'Shift finished successfully. ML model update started in the background.';
          this.closeFinishShiftDialog();
          this.isLoading = false;
        },
        error: (error: unknown) => {
          this.actionErrorMessage = this.resolveErrorMessage(error);
          this.isLoading = false;
        }
      });
  }

  protected getPendingFinishShiftAssignedCount(jobRole: JobRole): number {
    if (!this.pendingFinishShift) {
      return 0;
    }

    return (
      this.pendingFinishShift.shift.roleGroups.find(
        (roleGroup) => roleGroup.jobRole === jobRole
      )?.assignedCount || 0
    );
  }

  protected get validationStatusLabel(): string {
    if (!this.validationResult) {
      return '';
    }

    if (this.validationResult.status === 'ready_to_save') {
      return 'Ready to save';
    }

    if (this.validationResult.status === 'ready_with_warnings') {
      return 'Has warnings';
    }

    return 'Needs fixes';
  }

  protected get validationStatusClass(): string {
    return this.validationResult?.status || 'ready_to_save';
  }

  protected get hasValidationWarnings(): boolean {
    return Boolean(this.validationResult?.warnings.length);
  }

  protected get blockingValidationIssues(): (ScheduleCoverageIssue | ScheduleAssignmentIssue)[] {
    if (!this.validationResult) {
      return [];
    }

    return [
      ...this.validationResult.coverageIssues,
      ...this.validationResult.invalidAssignments.filter(
        (issue) => issue.severity === 'error' && !this.isSameDayDoubleAssignmentIssue(issue)
      )
    ];
  }

  protected get otherValidationWarnings(): ScheduleAssignmentIssue[] {
    if (!this.validationResult) {
      return [];
    }

    return [
      ...this.validationResult.availabilityIssues,
      ...this.validationResult.invalidAssignments.filter(
        (issue) => issue.severity === 'warning' && !this.isSameDayDoubleAssignmentIssue(issue)
      )
    ];
  }

  protected get visibleBlockingValidationIssues(): (ScheduleCoverageIssue | ScheduleAssignmentIssue)[] {
    return this.isBlockingIssuesExpanded
      ? this.blockingValidationIssues
      : this.blockingValidationIssues.slice(0, 3);
  }

  protected get hiddenBlockingIssueCount(): number {
    return this.isBlockingIssuesExpanded
      ? 0
      : Math.max(0, this.blockingValidationIssues.length - 3);
  }

  protected get visibleStrengthWarnings(): ScheduleStrengthIssue[] {
    if (!this.validationResult) {
      return [];
    }

    return this.isStrengthWarningsExpanded
      ? this.validationResult.strengthIssues
      : this.validationResult.strengthIssues.slice(0, 3);
  }

  protected get hiddenStrengthWarningCount(): number {
    return this.isStrengthWarningsExpanded
      ? 0
      : Math.max(0, (this.validationResult?.strengthIssues.length || 0) - 3);
  }

  protected get visibleFairnessWarnings(): ScheduleFairnessWarning[] {
    if (!this.validationResult) {
      return [];
    }

    const sortedWarnings = this.validationResult.fairnessWarnings
      .slice()
      .sort((left, right) => right.gap - left.gap);

    return this.isFairnessWarningsExpanded
      ? sortedWarnings
      : sortedWarnings.slice(0, 3);
  }

  protected get hiddenFairnessWarningCount(): number {
    return this.isFairnessWarningsExpanded
      ? 0
      : Math.max(0, (this.validationResult?.fairnessWarnings.length || 0) - 3);
  }

  protected get validationWarningCount(): number {
    if (!this.validationResult) {
      return 0;
    }

    return (
      this.validationResult.strengthIssues.length +
      this.validationResult.fairnessWarnings.length
    );
  }

  protected get hasValidationReportIssues(): boolean {
    return Boolean(this.blockingValidationIssues.length || this.validationWarningCount);
  }

  protected toggleBlockingIssuesExpanded(): void {
    this.isBlockingIssuesExpanded = !this.isBlockingIssuesExpanded;
  }

  protected toggleStrengthWarningsExpanded(): void {
    this.isStrengthWarningsExpanded = !this.isStrengthWarningsExpanded;
  }

  protected toggleFairnessWarningsExpanded(): void {
    this.isFairnessWarningsExpanded = !this.isFairnessWarningsExpanded;
  }

  protected formatValidationIssueTitle(
    issue: ScheduleValidationIssue | ScheduleCoverageIssue | ScheduleStrengthIssue
  ): string {
    const date = 'date' in issue && issue.date ? this.formatValidationDate(issue.date) : '';
    const shiftType = 'shiftType' in issue && issue.shiftType
      ? this.formatValidationShiftType(issue.shiftType)
      : '';
    const roleLabel = 'roleLabel' in issue && issue.roleLabel ? issue.roleLabel : '';

    return [date, shiftType, roleLabel].filter(Boolean).join(' - ');
  }

  protected formatAssignmentIssueTitle(issue: ScheduleAssignmentIssue): string {
    return `${issue.employeeName} - ${this.formatValidationIssueTitle(issue)}`;
  }

  protected formatStrengthWarningLine(issue: ScheduleStrengthIssue): string {
    return `Strength gap ${issue.deficit}`;
  }

  protected isCoverageIssue(
    issue: ScheduleCoverageIssue | ScheduleAssignmentIssue
  ): issue is ScheduleCoverageIssue {
    return 'missingCount' in issue;
  }

  protected formatValidationShiftType(shiftType: string): string {
    return shiftType.charAt(0).toUpperCase() + shiftType.slice(1);
  }

  private formatValidationDate(dateKey: string): string {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric'
    }).format(new Date(`${dateKey}T00:00:00`));
  }

  private isSameDayDoubleAssignmentIssue(issue: ScheduleAssignmentIssue): boolean {
    const message = issue.message.toLowerCase();

    return (
      issue.type === 'same_day_double_shift' ||
      issue.type === 'employee_scheduled_multiple_shifts_same_day' ||
      (message.includes('more than once') && message.includes('same day'))
    );
  }

  protected publishSchedule(): void {
    if (!this.board?.scheduleId || !this.canManageSchedule()) {
      return;
    }

    // פרסום/ביטול פרסום פועל רק על סידור שכבר נשמר ויש לו scheduleId.
    this.isLoading = true;
    this.errorMessage = '';
    this.actionErrorMessage = '';
    this.successMessage = '';

    // אם יש publishedAt מבטלים פרסום, אחרת מפרסמים.
    const publishRequest = this.board.publishedAt
      ? this.scheduleApiService.unpublishSchedule(this.board.scheduleId)
      : this.scheduleApiService.publishSchedule(this.board.scheduleId);

    publishRequest
      .subscribe({
        // השרת מחזיר board מעודכן עם publishedAt חדש או null.
        next: (board) => {
          this.board = board;
          this.successMessage = board.publishedAt
            ? 'Schedule published.'
            : 'Schedule unpublished.';
          this.hasUnsavedChanges = false;
          this.isLoading = false;
        },
        error: (error: unknown) => {
          this.errorMessage = this.resolveErrorMessage(error);
          this.isLoading = false;
        }
      });
  }

  protected updateShiftRequiredStrength(request: ShiftRequirementsUpdate): void {
    if (!this.canManageSchedule()) {
      return;
    }

    this.actionErrorMessage = '';
    this.successMessage = '';
    this.validationResult = null;

    this.scheduleApiService
      .updateShiftRequirements(request)
      .subscribe({
        next: (board) => {
          if (this.isUsableScheduleBoard(board)) {
            this.board = board;
            this.successMessage = 'Shift requirements updated.';
          } else {
            this.reloadCurrentScheduleAfterAction('Shift requirements updated.');
          }
        },
        error: (error: unknown) => {
          this.actionErrorMessage = this.resolveErrorMessage(error);
        }
      });
  }

  protected applyMlPrediction(shiftId: number): void {
    if (!this.canManageSchedule()) {
      return;
    }

    this.actionErrorMessage = '';
    this.successMessage = '';
    this.validationResult = null;

    const requirements = this.buildMlRecommendationRequirements(shiftId);

    if (!requirements) {
      return;
    }

    this.scheduleApiService.updateShiftRequirements(requirements).subscribe({
      next: (board) => {
        if (this.isUsableScheduleBoard(board)) {
          this.board = board;
          this.successMessage = 'ML recommendation applied and saved.';
        } else {
          this.reloadCurrentScheduleAfterAction('ML recommendation applied and saved.');
        }

        this.loadMlPredictions();
      },
      error: (error: unknown) => {
        this.actionErrorMessage = this.resolveErrorMessage(error);
      }
    });
  }

  private isUsableScheduleBoard(
    board: ScheduleBoardResponse | null | undefined
  ): board is ScheduleBoardResponse {
    return Boolean(
      board &&
        Array.isArray(board.days) &&
        board.weekStartDate &&
        board.weekEndDate
    );
  }

  private reloadCurrentScheduleAfterAction(successMessage: string): void {
    this.scheduleApiService.getSchedule(this.selectedWeekStartDate).subscribe({
      next: (board) => {
        if (this.isUsableScheduleBoard(board)) {
          this.board = board.scheduleId || board.days.length ? board : this.board;
          this.successMessage = successMessage;
        }
      },
      error: (error: unknown) => {
        this.actionErrorMessage = this.resolveErrorMessage(error);
      }
    });
  }

  private loadMlPredictions(): void {
    this.mlRecommendationsApiService
      .getPredictions(this.selectedWeekStartDate)
      .subscribe({
        next: (response) => {
          this.setMlPredictions(response.predictions);
        },
        error: () => {
          this.mlPredictionsByShiftId = new Map();
        }
      });
  }

  private setMlPredictions(predictions: ShiftMlPrediction[]): void {
    this.mlPredictionsByShiftId = new Map(
      predictions
        .filter((prediction) => prediction.recommendedWaiters !== null)
        .map((prediction) => [prediction.shiftId, prediction])
    );
  }

  private flattenAssignments(board: ScheduleBoardResponse): SaveScheduleAssignment[] {
    return board.days.flatMap((day) =>
      day.shifts.flatMap((shift) =>
        shift.roleGroups.flatMap((roleGroup) =>
          roleGroup.assignedWorkers.map((worker) => ({
            shiftId: shift.shiftId,
            employeeId: worker.employeeId,
            jobRole: roleGroup.jobRole
          }))
        )
      )
    );
  }

  private buildMlRecommendationRequirements(
    shiftId: number
  ): ShiftRequirementsUpdate | null {
    const shift = this.findShiftById(shiftId);
    const prediction = this.mlPredictionsByShiftId.get(shiftId);

    if (!shift || !prediction) {
      this.actionErrorMessage = 'ML recommendation is no longer available for this shift.';
      return null;
    }

    const recommendedWaiters = Number(prediction.recommendedWaiters);
    const requiredStrengthScore = this.getShiftRequiredStrengthScore(shift);

    if (!Number.isInteger(recommendedWaiters) || recommendedWaiters <= 0) {
      this.actionErrorMessage = 'ML recommendation returned an invalid waiter count.';
      return null;
    }

    return {
      shiftId,
      requiredWaiters: recommendedWaiters,
      requiredBartenders: this.getShiftRequiredCount(shift, 'bartender'),
      requiredShiftLeaders: this.getShiftRequiredCount(shift, 'shift_leader'),
      requiredStrengthScore,
    };
  }

  private findShiftById(shiftId: number): ScheduleShift | null {
    if (!this.board) {
      return null;
    }

    for (const day of this.board.days) {
      for (const shift of day.shifts) {
        if (shift.shiftId === shiftId) {
          return shift;
        }
      }
    }

    return null;
  }

  private findDayForShift(shiftId: number): {
    dayName: string;
    date: string;
  } | null {
    if (!this.board) {
      return null;
    }

    for (const day of this.board.days) {
      if (day.shifts.some((shift) => shift.shiftId === shiftId)) {
        return {
          dayName: day.dayName,
          date: day.date,
        };
      }
    }

    return null;
  }

  private createDefaultFinishShiftFeedback(): FinishShiftFeedback {
    return {
      actualCustomers: null,
      actualWaitersNeeded: null,
      managerRating: null,
    };
  }

  private readPositiveNumberInput(event: Event): number | null {
    const input = event.target as HTMLInputElement | null;
    const value = Number(input?.value);

    return Number.isFinite(value) && value > 0 ? value : null;
  }

  private getShiftRequiredCount(shift: ScheduleShift, jobRole: JobRole): number {
    return (
      shift.roleGroups.find((roleGroup) => roleGroup.jobRole === jobRole)
        ?.requiredCount || 0
    );
  }

  private getShiftRequiredStrengthScore(shift: ScheduleShift): number {
    return (
      shift.requiredStrengthScore ??
      shift.roleGroups.find((roleGroup) => roleGroup.jobRole === 'waiter')
        ?.requiredStrengthScore ??
      0
    );
  }

  private getAssignedCountsByEmployee(): Map<number, number> {
    const assignedCounts = new Map<number, number>();

    if (!this.board) {
      return assignedCounts;
    }

    for (const day of this.board.days) {
      for (const shift of day.shifts) {
        for (const roleGroup of shift.roleGroups) {
          for (const worker of roleGroup.assignedWorkers) {
            assignedCounts.set(
              worker.employeeId,
              (assignedCounts.get(worker.employeeId) || 0) + 1
            );
          }
        }
      }
    }

    return assignedCounts;
  }

  private getProblemShiftIds(filter: 'gaps' | 'strength'): Set<number> {
    const problemShiftIds = new Set<number>();

    if (!this.board) {
      return problemShiftIds;
    }

    for (const day of this.board.days) {
      for (const shift of day.shifts) {
        const hasUnfilledSlot = shift.roleGroups.some(
          (roleGroup) => (roleGroup.uncoveredSlots || 0) > 0
        );
        const hasStrengthRisk = shift.roleGroups.some((roleGroup) =>
          this.isRoleGroupBelowStrength(roleGroup)
        );

        if (
          (filter === 'gaps' && hasUnfilledSlot) ||
          (filter === 'strength' && hasStrengthRisk)
        ) {
          problemShiftIds.add(shift.shiftId);
        }
      }
    }

    return problemShiftIds;
  }

  private refreshRoleGroupMetrics(roleGroup: ScheduleRoleGroup): void {
    roleGroup.assignedCount = roleGroup.assignedWorkers.length;
    roleGroup.uncoveredSlots = Math.max(
      0,
      roleGroup.requiredCount - roleGroup.assignedCount
    );

    if (roleGroup.assignedStrengthScore !== undefined) {
      roleGroup.assignedStrengthScore = Number(
        roleGroup.assignedWorkers
          .reduce((total, worker) => total + (worker.strengthScore || 0), 0)
          .toFixed(1)
      );
    }

    if (roleGroup.requiredStrengthScore !== undefined) {
      roleGroup.meetsStrengthTarget =
        (roleGroup.assignedStrengthScore || 0) >= roleGroup.requiredStrengthScore;
    }
  }

  private getProblemRoleGroupKeys(filter: 'gaps' | 'strength'): Set<string> {
    const problemRoleGroupKeys = new Set<string>();

    if (!this.board) {
      return problemRoleGroupKeys;
    }

    for (const day of this.board.days) {
      for (const shift of day.shifts) {
        for (const roleGroup of shift.roleGroups) {
          const hasProblem =
            filter === 'gaps'
              ? (roleGroup.uncoveredSlots || 0) > 0
              : this.isRoleGroupBelowStrength(roleGroup);

          if (hasProblem) {
            problemRoleGroupKeys.add(`${shift.shiftId}:${roleGroup.jobRole}`);
          }
        }
      }
    }

    return problemRoleGroupKeys;
  }

  private isRoleGroupBelowStrength(roleGroup: {
    assignedStrengthScore?: number;
    requiredStrengthScore?: number;
  }): boolean {
    const assignedStrength = roleGroup.assignedStrengthScore || 0;
    const requiredStrength = roleGroup.requiredStrengthScore || 0;

    return requiredStrength > 0 && assignedStrength < requiredStrength;
  }

  protected formatShiftType(shift: ScheduleShift): string {
    return shift.shiftType.charAt(0).toUpperCase() + shift.shiftType.slice(1);
  }

  private changeSelectedWeek(dayOffset: number): void {
    this.selectedWeekStartDate = this.addDays(
      this.selectedWeekStartDate,
      dayOffset
    );
    this.loadSchedule();

    if (this.canReplaceScheduleWorkers()) {
      this.loadReplacementAvailability();
    }

    if (this.canManageSchedule()) {
      this.loadMlPredictions();
    }
  }

  private loadReplacementAvailability(): void {
    this.availabilityApiService
      .getAllAvailability(this.selectedWeekStartDate)
      .subscribe({
        next: (availability) => {
          this.availableShiftIdsByEmployeeId = new Map(
            availability.submissions.map((submission) => [
              submission.employeeId,
              new Set(submission.shiftIds)
            ])
          );
        },
        error: () => {
          this.availableShiftIdsByEmployeeId = new Map();
        }
      });
  }

  protected clearSchedule(): void {
    if (!this.board?.scheduleId) {
      return;
    }

    const confirmed = window.confirm('Are you sure you want to delete this schedule?');

    if (!confirmed) {
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    this.actionErrorMessage = '';
    this.successMessage = '';
    this.validationResult = null;

    this.scheduleApiService
      .clearScheduleAssignments(this.board.scheduleId)
      .subscribe({
        next: (board) => {
          this.board = board.days.length ? board : null;
          this.successMessage = 'Schedule cleared.';
          this.hasUnsavedChanges = false;
          this.showEmployeesUnderTarget = false;
          this.isLoading = false;
        },
        error: (error: unknown) => {
          this.errorMessage = this.resolveErrorMessage(error);
          this.isLoading = false;
        }
      });
  }

  private getAssignedShiftCount(employeeId: number): number {
    return this.getAssignedCountsByEmployee().get(employeeId) || 0;
  }

  private getRequestedShiftCount(employeeId: number): number {
    return this.availableShiftIdsByEmployeeId.get(employeeId)?.size || 0;
  }

  private calculateTargetShifts(employee: Employee, requestedShifts: number): number {
    const strengthScore = this.calculateEmployeeStrength(employee);
    const normalizedStrength = strengthScore / 10;

    return Number((requestedShifts * (0.55 + 0.45 * normalizedStrength)).toFixed(1));
  }

  private calculateEmployeeStrength(employee: Employee): number {
    const seniorityScore = Math.min(10, ((employee.seniorityMonths || 0) / 24) * 10);

    return (
      0.35 * (employee.professionalism || 0) +
      0.3 * (employee.responsibility || 0) +
      0.2 * (employee.pressureHandling || 0) +
      0.1 * seniorityScore +
      0.05 * (employee.potential || 0)
    );
  }

  private formatJobRole(jobRole: string): string {
    if (jobRole === 'shift_leader') {
      return 'Shift manager';
    }

    return jobRole.replace('_', ' ');
  }

  private addDays(dateKey: string, dayOffset: number): string {
    return addDaysToDateKey(dateKey, dayOffset);
  }

  private formatDisplayDate(dateKey: string): string {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }).format(new Date(`${dateKey}T00:00:00`));
  }

  private resolveErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse && error.error?.message) {
      return error.error.message;
    }

    return 'Schedule action failed. Check that the backend is running and try again.';
  }

  private isAssignmentWarningError(error: unknown): boolean {
    return Boolean(
      error instanceof HttpErrorResponse &&
        error.status === 400 &&
        Array.isArray(error.error?.details?.warnings) &&
        error.error.details.warnings.length > 0
    );
  }
}
