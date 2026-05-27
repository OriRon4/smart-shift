import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',          //זה השם של הקומפוננטה ב־HTML
  standalone: true,          
  imports: [
    RouterOutlet       //המקום שבו Angular מציג את הקומפוננטה שמתאימה ל־route הנוכחי.
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent {}   //רק משמשת כ־root component.
