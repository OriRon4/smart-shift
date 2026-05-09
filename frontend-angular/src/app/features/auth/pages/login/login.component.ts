import { Component } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';

import { AuthService } from '../../../../core/auth/auth.service';

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
  protected registerEmail = '';
  protected registerUsername = '';
  protected registerPassword = '';
  protected isRegisterMode = false;
  protected isLoading = false;
  protected errorMessage = '';

  constructor(
    private readonly authService: AuthService,
    private readonly router: Router
  ) {}

  protected useDemoAccount(loginValue: string): void {
    this.loginValue = loginValue;
    this.password = 'password';
  }

  submit(): void {
    this.isLoading = true;
    this.errorMessage = '';

    this.authService.login(this.loginValue, this.password).subscribe({
      next: () => {
        this.isLoading = false;
        void this.router.navigate(['/schedule']);
      },
      error: (error: unknown) => {
        this.errorMessage = this.resolveErrorMessage(error);
        this.isLoading = false;
      }
    });
  }

  registerWorker(): void {
    this.isLoading = true;
    this.errorMessage = '';

    this.authService
      .registerWorker({
        fullName: this.registerFullName,
        username: this.registerUsername,
        email: this.registerEmail,
        password: this.registerPassword
      })
      .subscribe({
        next: () => {
          this.isLoading = false;
          void this.router.navigate(['/dashboard']);
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
  }

  protected showRegister(): void {
    this.isRegisterMode = true;
    this.errorMessage = '';
  }

  protected updateLoginValue(event: Event): void {
    this.loginValue = (event.target as HTMLInputElement).value;
  }

  protected updatePassword(event: Event): void {
    this.password = (event.target as HTMLInputElement).value;
  }

  protected updateRegisterField(
    fieldName: 'registerFullName' | 'registerEmail' | 'registerUsername' | 'registerPassword',
    event: Event
  ): void {
    this[fieldName] = (event.target as HTMLInputElement).value;
  }

  private resolveErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse && error.error?.message) {
      return error.error.message;
    }

    return 'Could not log in. Check that the backend is running and try again.';
  }
}
