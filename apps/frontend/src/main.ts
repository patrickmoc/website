import { AppComponent } from './app/app.component';
import { provideAnimations } from '@angular/platform-browser/animations';
import { bootstrapApplication, BrowserModule } from '@angular/platform-browser';
import { AuthInterceptor } from './app/interceptors/auth.interceptor';
import {
  HTTP_INTERCEPTORS,
  withInterceptorsFromDi,
  provideHttpClient
} from '@angular/common/http';
import { APP_BASE_HREF } from '@angular/common';
import { APP_ROUTES } from './app/app.routes';
import { provideRouter } from '@angular/router';
import { importProvidersFrom } from '@angular/core';
import { SharedModule } from './app/shared.module';
import { MessageService } from 'primeng/api';

bootstrapApplication(AppComponent, {
  providers: [
    importProvidersFrom(SharedModule, BrowserModule),
    { provide: APP_BASE_HREF, useValue: '/' },
    {
      provide: HTTP_INTERCEPTORS,
      useClass: AuthInterceptor,
      multi: true
    },
    provideRouter(APP_ROUTES),
    provideAnimations(),
    provideHttpClient(withInterceptorsFromDi()),
    // PrimeNg's MessageService is injected into other services and doesn't have
    // `providedIn: root` so we provider it globally here.
    MessageService
  ]
}).catch((error) => console.error(error));
