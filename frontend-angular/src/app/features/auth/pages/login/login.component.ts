import { Component } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';

import { AuthService } from '../../../../core/auth/auth.service';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Component({
  selector: 'app-login',
  standalone: true,
  templateUrl: './login.component.html',
  styleUrl: './login.component.css'
})
export class LoginComponent {
  protected loginValue = 'manager@example.com';
  protected password = 'password';
  protected registerFullName = '';
  protected registerPhoneNumber = '';
  protected registerEmail = '';
  protected registerUsername = '';
  protected registerPassword = '';
  protected isRegisterMode = false;
  protected isLoading = false;
  protected errorMessage = '';
  protected successMessage = '';

  constructor(
    private readonly authService: AuthService,
    private readonly router: Router
  ) {}

  protected useDemoAccount(loginValue: string): void {
    this.loginValue = loginValue;
    this.password = 'password';
  }

  // נקודת הכניסה של התחברות מהטופס במסך.
  submit(): void {
    // בודקים שהקלט נראה תקין לפני קריאת ה-API.
    const login = this.loginValue.trim();

    if (login.includes('@') && !EMAIL_PATTERN.test(login)) {
      this.errorMessage = 'Enter a valid email address, or use a username.';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    this.successMessage = '';

    // שולחים login/password ל-AuthService; ה-service מחזיר Observable.
    this.authService.login(this.loginValue, this.password).subscribe({
      // בהצלחה המשתמש כבר נשמר ב-service, ואז עוברים למסך הסידור.
      next: () => {
        this.isLoading = false;
        void this.router.navigate(['/dashboard']);
      },
      // בשגיאה מציגים הודעה במסך ונשארים בעמוד התחברות.
      error: (error: unknown) => {
        this.errorMessage = this.resolveErrorMessage(error);
        this.isLoading = false;
      }
    });
  }

  registerWorker(): void {
    if (!EMAIL_PATTERN.test(this.registerEmail.trim())) {
      this.errorMessage = 'Enter a valid email address.';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    this.successMessage = '';

    this.authService
      .registerWorker({
        fullName: this.registerFullName,
        phoneNumber: this.registerPhoneNumber,
        username: this.registerUsername,
        email: this.registerEmail,
        password: this.registerPassword
      })
      .subscribe({
        next: () => {
          this.isLoading = false;
          this.isRegisterMode = false;
          this.successMessage = 'Your account is pending manager approval.';
        },
        error: (error: unknown) => {
          this.errorMessage = this.resolveErrorMessage(error);
          this.isLoading = false;
        }
      });
  }

  protected showLogin(): void {
    this.isRegisterMode = false;
    this.errorMessage = '';
    this.successMessage = '';
  }

  protected showRegister(): void {
    this.isRegisterMode = true;
    this.errorMessage = '';
    this.successMessage = '';
  }

  protected updateLoginValue(event: Event): void {
    this.loginValue = (event.target as HTMLInputElement).value;
  }

  protected updatePassword(event: Event): void {
    this.password = (event.target as HTMLInputElement).value;
  }

  protected updateRegisterField(
    fieldName:
      | 'registerFullName'
      | 'registerPhoneNumber'
      | 'registerEmail'
      | 'registerUsername'
      | 'registerPassword',
    event: Event
  ): void {
    this[fieldName] = (event.target as HTMLInputElement).value;
  }

  private resolveErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse && error.status === 409) {
      return 'Username or email already exists';
    }

    if (error instanceof HttpErrorResponse && error.error?.message) {
      return error.error.message;
    }

    return 'Could not log in. Check that the backend is running and try again.';
  }
}
