import { Component, OnInit } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';

import { WeekSelectorComponent } from '../../../schedule/components/week-selector/week-selector.component';
import { AvailabilityResponse } from '../../models/availability.models';
import { AvailabilityApiService } from '../../services/availability-api.service';
import {
  addDaysToDateKey,
  getCurrentWeekStartDate
} from '../../../../shared/date/week-date.util';

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

  constructor(private readonly availabilityApiService: AvailabilityApiService) {}

  ngOnInit(): void {
    // בכניסה למסך טוענים את הזמינות של השבוע הנוכחי.
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

  protected toggleShift(shiftId: number): void {
    // אם המשמרת כבר נבחרה מסירים אותה, אחרת מוסיפים אותה.
    if (this.selectedShiftIds.has(shiftId)) {
      this.selectedShiftIds.delete(shiftId);
      return;
    }

    this.selectedShiftIds.add(shiftId);
  }

  protected submitAvailability(): void {
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
}
