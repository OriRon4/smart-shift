import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';

import { AppComponent } from './app/app.component';
import { authInterceptor } from './app/core/auth/auth.interceptor';
import { routes } from './app/app.routes';

bootstrapApplication(AppComponent, {    //תתחיל את האפליקציה מהקומפוננטה הראשית הזאת.
  providers: [
    provideHttpClient(withInterceptors([authInterceptor])),  //תן לאפליקציה יכולת לשלוח בקשות HTTP, וכל בקשה תעבור דרך authInterceptor
    provideRouter(routes)           //תפעיל routing לפי ההגדרות שנמצאות בקובץ app.routes.ts
  ]
//אם Angular נכשל בהפעלה, השגיאה תודפס ל־console.
// unknown - אני לא יודע מראש איזה סוג שגיאה תגיע
}).catch((error: unknown) => {
  console.error(error);
});
