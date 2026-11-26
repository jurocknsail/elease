import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ParseClient } from '../../core/parse/parse-client';
import { FakeParseClient } from '../../core/parse/testing/fake-parse-client';
import { ThemeService } from '../../core/theme/theme.service';
import { Shell } from './shell';

@Component({ template: '<p id="page">Contenu de la page</p>' })
class Page {}

async function setup(url = '/appels') {
  localStorage.clear();
  delete document.documentElement.dataset['theme'];
  const fake = new FakeParseClient();
  fake.userName = 'julien';
  TestBed.configureTestingModule({
    providers: [
      { provide: ParseClient, useValue: fake },
      provideRouter([
        {
          path: '',
          component: Shell,
          children: [
            { path: 'appels', component: Page },
            { path: 'appels/envoi', component: Page, data: { fullWidth: true } },
            { path: 'locataires', component: Page },
            { path: 'locataires/:id', component: Page },
            { path: 'reglages', component: Page },
          ],
        },
      ]),
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url, Shell);
  harness.detectChanges();
  const root = harness.routeNativeElement as HTMLElement;
  return { harness, root, router: TestBed.inject(Router) };
}

function navs(root: HTMLElement): { sidebar: HTMLElement; tabs: HTMLElement } {
  const all = [...root.querySelectorAll<HTMLElement>('nav')];
  expect(all).toHaveLength(2);
  return { sidebar: all[0], tabs: all[1] };
}

const labels = (nav: HTMLElement) =>
  [...nav.querySelectorAll('a')].map((a) => a.textContent?.trim());

describe('Shell', () => {
  afterEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset['theme'];
  });

  describe('navigation', () => {
    it('has the logo « E-Lease » and the three links « Appels de loyer », « Locataires », « Réglages » in the sidebar and the bottom bar', async () => {
      const { root } = await setup();
      const aside = root.querySelector('aside') as HTMLElement;

      expect(aside.textContent).toContain('E-Lease');
      expect(aside.querySelector('img')?.getAttribute('alt')).toBe('');
      for (const nav of [navs(root).sidebar, navs(root).tabs]) {
        expect(labels(nav)).toEqual(['Appels de loyer', 'Locataires', 'Réglages']);
        expect([...nav.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
          '/appels',
          '/locataires',
          '/reglages',
        ]);
      }
    });

    it('names both navigations and uses the nav, aside and main landmarks', async () => {
      const { root } = await setup();
      const { sidebar, tabs } = navs(root);

      expect(sidebar.getAttribute('aria-label')).toBe('Navigation principale');
      expect(tabs.getAttribute('aria-label')).toBe('Navigation principale');
      expect(root.querySelector('aside')).not.toBeNull();
      expect(root.querySelectorAll('main')).toHaveLength(1);
      expect(root.querySelector('main #page')?.textContent).toBe('Contenu de la page');
    });

    it.each([
      ['/appels/envoi', '/appels'],
      ['/locataires/abc123', '/locataires'],
    ])(
      'marks only the section of %s as the current page, in both navigations',
      async (url, href) => {
        const { root } = await setup(url);
        const { sidebar, tabs } = navs(root);

        for (const nav of [sidebar, tabs]) {
          const current = [...nav.querySelectorAll('a')].filter(
            (a) => a.getAttribute('aria-current') === 'page',
          );
          expect(current.map((a) => a.getAttribute('href'))).toEqual([href]);
        }
      },
    );
  });

  describe('scroll', () => {
    it('scrolls the content back to the top on every navigation (the container is never re-created)', async () => {
      const { root, harness } = await setup('/appels');
      const main = root.querySelector('main') as HTMLElement;
      main.scrollTop = 500;
      expect(main.scrollTop).toBe(500);

      await harness.navigateByUrl('/locataires', Shell);
      harness.detectChanges();

      expect(root.querySelector('main')).toBe(main);
      expect(main.scrollTop).toBe(0);

      main.scrollTop = 300;
      await harness.navigateByUrl('/appels/envoi', Shell);
      expect(main.scrollTop).toBe(0);
    });
  });

  describe('user and theme', () => {
    it('shows who is signed in', async () => {
      const { root } = await setup();

      expect((root.querySelector('aside') as HTMLElement).textContent).toContain(
        'Connecté en tant que',
      );
      expect((root.querySelector('aside') as HTMLElement).textContent).toContain('julien');
    });

    it('cycles Système, Clair, Sombre through ThemeService, with the state visible and in the name', async () => {
      const { root, harness } = await setup();
      const theme = TestBed.inject(ThemeService);
      const toggle = () => root.querySelector('aside app-theme-toggle button') as HTMLButtonElement;
      expect(theme.mode()).toBe('system');
      expect(toggle().textContent).toContain('Thème : Système');
      expect(toggle().querySelector('.sr-only')?.textContent).toContain('passer à Clair');

      const seen: string[] = [];
      for (let i = 0; i < 3; i++) {
        toggle().click();
        harness.detectChanges();
        seen.push(theme.mode());
      }

      expect(seen).toEqual(['light', 'dark', 'system']);
    });
  });
});
