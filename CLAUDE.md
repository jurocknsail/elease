# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

E-Lease is a French tenant and rental property management application built with Angular 17, Ionic 7, and Capacitor 5. It supports web, Android, and iOS platforms. The app manages leaseholders, rental properties (leases), and generates PDF rent notifications with email delivery.

## Commands

All commands should be run from the `elease/` directory:

```bash
npm run start     # Development server (ng serve)
npm run build     # Production build to www/
npm run watch     # Development build with watch mode
npm run test      # Run unit tests with Karma/Jasmine
npm run lint      # Run ESLint checks
```

## Architecture

### Technology Stack
- **Frontend**: Angular 17 with Ionic 7 UI components, Angular Material
- **Backend**: Parse Server (credentials in environment files)
- **Mobile**: Capacitor 5 for Android/iOS native builds
- **PDF Generation**: pdfmake
- **External API**: INSEE API for French housing indices (IRL/ILAT)

### Routing Structure
The app uses lazy-loaded feature modules with route protection via `AuthGuard`:
- `/login` - Public authentication page
- `/tabs` - Main tabbed interface (protected)
- `/leaseholder-details/:id` - Leaseholder detail view (protected)
- `/filebrowser` - Document browser (protected)

### Data Models (`src/app/model/`)
- **Leaseholder**: Tenant with name, email, phone, and array of leases
- **Lease**: Property with address, pricing (price/charge), indexing, renewal dates, and `isPro` flag for professional vs residential classification
- **LeasePdfInfo**: PDF metadata for email attachments

### Core Services (`src/app/services/`)
- **ParseService**: All CRUD operations for leaseholders/leases, PDF/email management, Parse ACL security (per-user data isolation)
- **InseeService**: Fetches IRL (residential) and ILAT (professional) housing index values from INSEE API

### Key Patterns
- **Authentication**: Parse User with ACL on all objects for data isolation
- **State Management**: In-memory service state (`leaseholders` array in ParseService) synced with Parse backend
- **Reactive Forms**: FormBuilder with custom validators (see `validators/phone-number.validator.ts`)

## Environment Configuration

Environment files (`src/environments/environment.ts` and `environment.prod.ts`) are git-ignored and contain:
- `parseAppId`, `parseJsKey`, `parseServerUrl` - Parse Server credentials
- `inseeApiKey` - INSEE API key for housing indices
- `sandbox` - Email sandbox mode flag

## Code Conventions

- **Component suffix**: Use `Page` or `Component` suffix (ESLint enforced)
- **Selector prefix**: `app-` kebab-case for components
- **Strict TypeScript**: Enabled with strict null checks
- **Module pattern**: Feature modules per page with lazy loading

## PDF/Email Workflow

1. `ParseService.addLeaseholderPDF()` accumulates PDF data by recipient email
2. `ParseService.sendEmail()` calls Parse Cloud function `sendEmail` with attachments
3. Uses `LeasePdfInfo` model for PDF metadata (name, base64 content, date)

## Mobile Builds

Capacitor configuration in `capacitor.config.ts`:
- App ID: `io.ionic.starter`
- Web directory: `www/`
- Android scheme: HTTPS

After building, sync with `npx cap sync` to update native projects in `android/` and `ios/`.