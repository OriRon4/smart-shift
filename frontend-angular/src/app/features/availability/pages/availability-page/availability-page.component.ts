import { Component, OnInit } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';

import { WeekSelectorComponent } from '../../../schedule/components/week-selector/week-selector.component';
import { AvailabilityResponse } from '../../models/availability.models';
import { AvailabilityApiService } from '../../services/availability-api.service';
import {
  addDaysToDateKey,
  getCurrentWeekStartDate,
  getNextWeekStartDate,
  isAvailabilityNextWeekCutoffClosed,
  isCurrentWeekStartDate,
  isNextWeekStartDate,
  isPastWeekStartDate
} from '../../../../shared/date/week-date.util';
import { AuthService } from '../../../../core/auth/auth.service';

const PREVIOUS_WEEK_SUBMIT_MESSAGE =
  'Cannot submit availability for a previous week.';
const PREVIOUS_WEEK_EDIT_MESSAGE =
  'Viewing previous availability. Editing is closed.';
const CURRENT_WEEK_CLOSED_MESSAGE =
  'Availability for the current week is closed.';
const NEXT_WEEK_CLOSED_MESSAGE =
  'Availability submission for next week is closed.';

@Component({
  selector: 'app-availability-page',
  standalone: true,
  imports: [
    WeekSelectorComponent
  ],
  templateUrl: './availability-page.component.html',
  styleUrl: './availability-page.component.css'
})
export class AvailabilityPageComponent implements OnInit {
  // השבוע שעליו העובד מסמן זמינות.
  protected selectedWeekStartDate = getCurrentWeekStartDate();
  // התשובה מהשרת: ימים, משמרות ומה כבר נבחר.
  protected availability: AvailabilityResponse | null = null;
  // Set של shiftId -> האם העובד סימן שהוא פנוי למשמרת.
  protected selectedShiftIds = new Set<number>();
  protected isLoading = false;
  protected errorMessage = '';
  protected successMessage = '';
  protected readonly currentUser = this.authService.currentUser;

  constructor(
    private readonly availabilityApiService: AvailabilityApiService,
    private readonly authService: AuthService
  ) {}

  ngOnInit(): void {
    if (!this.isManager) {
      this.selectedWeekStartDate = getNextWeekStartDate();
    }

    // Load the selected week after choosing the role-specific default.
    this.loadAvailability();
  }

  protected get weekRangeLabel(): string {
    return `${this.formatDisplayDate(this.selectedWeekStartDate)} - ${this.formatDisplayDate(
      this.addDays(this.selectedWeekStartDate, 6)
    )}`;
  }

  protected previousWeek(): void {
    this.changeSelectedWeek(-7);
  }

  protected nextWeek(): void {
    this.changeSelectedWeek(7);
  }

  protected isSelected(shiftId: number): boolean {
    return this.selectedShiftIds.has(shiftId);
  }

  protected get isManager(): boolean {
    return this.currentUser()?.permissionRole === 'manager';
  }

  protected get isSelectedWeekPast(): boolean {
    return isPastWeekStartDate(this.selectedWeekStartDate);
  }

  protected get isSelectedWeekCurrent(): boolean {
    return isCurrentWeekStartDate(this.selectedWeekStartDate);
  }

  protected get isSelectedWeekNext(): boolean {
    return isNextWeekStartDate(this.selectedWeekStartDate);
  }

  protected get canEditSelectedWeek(): boolean {
    return (
      this.isManager ||
      (!this.isSelectedWeekPast &&
        !this.isSelectedWeekCurrent &&
        (!this.isSelectedWeekNext || !isAvailabilityNextWeekCutoffClosed()))
    );
  }

  protected get availabilityHeading(): string {
    if (this.isManager) {
      return 'Submit Availability';
    }

    if (this.isSelectedWeekNext && this.canEditSelectedWeek) {
      return 'Submit your availability for next week';
    }

    if (this.isSelectedWeekNext) {
      return NEXT_WEEK_CLOSED_MESSAGE;
    }

    if (this.isSelectedWeekCurrent) {
      return CURRENT_WEEK_CLOSED_MESSAGE;
    }

    if (this.isSelectedWeekPast) {
      return 'Viewing previous availability';
    }

    return 'Submit your availability for a future week';
  }

  protected get availabilityDescription(): string {
    if (this.canEditSelectedWeek) {
      return 'Select the morning and evening shifts you can work.';
    }

    return 'You can view saved availability for this week, but editing is closed.';
  }

  protected get availabilityCardHelper(): string {
    return this.canEditSelectedWeek
      ? 'Choose any of the 14 weekly shifts'
      : 'Saved availability for the selected week';
  }

  protected get availabilityReadOnlyMessage(): string {
    if (this.canEditSelectedWeek) {
      return '';
    }

    if (this.isSelectedWeekPast) {
      return PREVIOUS_WEEK_EDIT_MESSAGE;
    }

    if (this.isSelectedWeekCurrent) {
      return CURRENT_WEEK_CLOSED_MESSAGE;
    }

    if (this.isSelectedWeekNext) {
      return NEXT_WEEK_CLOSED_MESSAGE;
    }

    return '';
  }

  protected toggleShift(shiftId: number): void {
    if (!this.canEditSelectedWeek) {
      this.errorMessage = this.getSubmitBlockedMessage();
      this.successMessage = '';
      return;
    }

    // אם המשמרת כבר נבחרה מסירים אותה, אחרת מוסיפים אותה.
    if (this.selectedShiftIds.has(shiftId)) {
      this.selectedShiftIds.delete(shiftId);
      return;
    }

    this.selectedShiftIds.add(shiftId);
  }

  protected submitAvailability(): void {
    if (!this.canEditSelectedWeek) {
      this.errorMessage = this.getSubmitBlockedMessage();
      this.successMessage = '';
      return;
    }

    // מתחילים שמירה ומנקים הודעות קודמות.
    this.isLoading = true;
    this.errorMessage = '';
    this.successMessage = '';

    this.availabilityApiService
      // שולחים לשרת את השבוע ואת כל ה-shiftIds שנבחרו.
      .submitMyAvailability(
        this.selectedWeekStartDate,
        [...this.selectedShiftIds.values()]
      )
      .subscribe({
        // השרת מחזיר גריד מעודכן; מחליפים את המצב המקומי.
        next: (availability) => {
          this.applyAvailability(availability);
          this.successMessage = 'Availability submitted.';
          this.isLoading = false;
        },
        // בשגיאה נשארים במסך ומציגים הודעה.
        error: (error: unknown) => {
          this.errorMessage = this.resolveErrorMessage(error);
          this.isLoading = false;
        }
      });
  }

  private loadAvailability(): void {
    // טוען מהשרת את הזמינות הקיימת לשבוע שנבחר.
    this.isLoading = true;
    this.errorMessage = '';
    this.successMessage = '';

    this.availabilityApiService
      .getMyAvailability(this.selectedWeekStartDate)
      .subscribe({
        // מעדכן גם את הגריד וגם את ה-Set של הבחירות.
        next: (availability) => {
          this.applyAvailability(availability);
          this.isLoading = false;
        },
        error: (error: unknown) => {
          this.errorMessage = this.resolveErrorMessage(error);
          this.isLoading = false;
        }
      });
  }

  private applyAvailability(availability: AvailabilityResponse): void {
    // selectedShiftIds נשמר כ-Set כדי שבדיקה/הוספה/מחיקה יהיו פשוטות.
    this.availability = availability;
    this.selectedShiftIds = new Set(availability.selectedShiftIds);
  }

  private changeSelectedWeek(dayOffset: number): void {
    // מעבר שבוע משנה תאריך ואז טוען זמינות חדשה.
    this.selectedWeekStartDate = this.addDays(
      this.selectedWeekStartDate,
      dayOffset
    );
    this.loadAvailability();
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

    return 'Availability action failed. Check that the backend is running and try again.';
  }

  private getSubmitBlockedMessage(): string {
    if (this.isSelectedWeekPast) {
      return PREVIOUS_WEEK_SUBMIT_MESSAGE;
    }

    return this.availabilityReadOnlyMessage || '';
  }
}
