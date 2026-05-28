import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-week-selector',
  standalone: true,
  templateUrl: './week-selector.component.html',
  styleUrl: './week-selector.component.css'
})
export class WeekSelectorComponent {
  // רכיב ילד: מקבל מצב מהאבא ומשדר אליו אירועים.
  // הטקסט שמוצג למשתמש עבור השבוע הנבחר.
  // הרכיב רק מדווח על פעולות המשתמש; העמוד מחזיק את המצב.
  @Input({ required: true }) weekRangeLabel = '';
  // בזמן טעינה חוסמים לחיצות חוזרות.
  @Input() isLoading = false;
  // האבא קובע אם למשתמש מותר ליצור סידור.
  @Input() canGenerate = false;

  // אירועים החוצה: הילד לא משנה שבוע לבד.
  @Output() previousWeek = new EventEmitter<void>();
  @Output() nextWeek = new EventEmitter<void>();
  // לחיצה על Generate משדרת לאבא להתחיל את הזרימה.
  @Output() generateSchedule = new EventEmitter<void>();


}
