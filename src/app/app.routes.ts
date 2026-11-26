import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth/auth.guard';

/**
 * `/login` is public (a signed-in user is sent on to `/appels`). Everything else sits under the shell
 * and the auth guard, which is also run for every child navigation: the session can end while the
 * shell stays open. The app opens on « Appels de loyer »; the router URL is the state, so a reload
 * comes back to the same screen (the session itself is restored from local storage by the SDK).
 *
 * Every feature page is lazy-loaded. The pages other than login are placeholders for now.
 */
export const routes: Routes = [
  {
    path: 'login',
    title: 'Connexion',
    canActivate: [guestGuard],
    // Also when only the query changes: a crafted `?returnUrl=/%6Cogin` makes the router decode the
    // address to /login again, and the guard (which keeps a signed-in user off this page) must run.
    runGuardsAndResolvers: 'always',
    loadComponent: () => import('./features/login/login.page').then((m) => m.LoginPage),
  },
  {
    path: '',
    canActivate: [authGuard],
    canActivateChild: [authGuard],
    loadComponent: () => import('./features/shell/shell').then((m) => m.Shell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'appels' },
      {
        path: 'appels',
        title: 'Appels de loyer',
        loadComponent: () =>
          import('./features/rent-calls/rent-calls.page').then((m) => m.RentCallsPage),
      },
      {
        path: 'appels/envoi',
        title: 'Envoi des appels de loyer',
        // Two panes (list and PDF preview): the shell gives this screen the whole width.
        data: { fullWidth: true },
        loadComponent: () => import('./features/rent-calls/send.page').then((m) => m.SendPage),
      },
      {
        path: 'locataires',
        title: 'Locataires',
        loadComponent: () => import('./features/tenants/tenants.page').then((m) => m.TenantsPage),
      },
      {
        path: 'locataires/:id',
        title: 'Locataire',
        loadComponent: () => import('./features/tenants/tenant-detail').then((m) => m.TenantDetail),
      },
      {
        path: 'reglages',
        title: 'Réglages',
        loadComponent: () =>
          import('./features/settings/settings.page').then((m) => m.SettingsPage),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
