import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-week-selector',
  standalone: true,
  templateUrl: './week-selector.component.html',
  styleUrl: './week-selector.component.css'
})
export class WeekSelectorComponent {
  // הרכיב רק מדווח על פעולות המשתמש; העמוד מחזיק את המצב.
  @Input({ required: true }) weekRangeLabel = '';
  @Input() isLoading = false;
  @Input() canGenerate = false;

  @Output() previousWeek = new EventEmitter<void>();
  @Output() nextWeek = new EventEmitter<void>();
  @Output() generateSchedule = new EventEmitter<void>();
}
