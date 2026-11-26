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
            { path: 'appels/envoi', component: Page },
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
    it('has the logo « E-Lease », « Appels de loyer », « Locataires » and « Réglages » in the sidebar', async () => {
      const { root } = await setup();
      const aside = root.querySelector('aside') as HTMLElement;

      expect(aside.textContent).toContain('E-Lease');
      expect(aside.querySelector('img')?.getAttribute('alt')).toBe('');
      expect(labels(navs(root).sidebar)).toEqual(['Appels de loyer', 'Locataires', 'Réglages']);
    });

    it('has the three tabs « Appels de loyer », « Locataires », « Réglages » in the bottom bar', async () => {
      const { root } = await setup();

      expect(labels(navs(root).tabs)).toEqual(['Appels de loyer', 'Locataires', 'Réglages']);
    });

    it('links to the real routes', async () => {
      const { root } = await setup();
      const { sidebar, tabs } = navs(root);

      for (const nav of [sidebar, tabs]) {
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

    it('lays the sidebar out from 768 px (md) and the bottom bar below it', async () => {
      const { root } = await setup();
      const aside = root.querySelector('aside') as HTMLElement;

      // `hidden md:flex`: displayed from 768 px only; the tab bar is `md:hidden`.
      expect(aside.classList.contains('hidden')).toBe(true);
      expect(aside.classList.contains('md:flex')).toBe(true);
      expect(aside.classList.contains('w-60')).toBe(true);
      expect(navs(root).tabs.classList.contains('md:hidden')).toBe(true);
    });

    it.each([
      ['/appels', '/appels'],
      ['/appels/envoi', '/appels'],
      ['/locataires', '/locataires'],
      ['/locataires/abc123', '/locataires'],
      ['/reglages', '/reglages'],
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

    it('follows the navigation: the current page moves', async () => {
      const { root, harness } = await setup('/appels');

      await harness.navigateByUrl('/locataires', Shell);
      harness.detectChanges();

      const current = navs(root).sidebar.querySelector('a[aria-current="page"]');
      expect(current?.textContent?.trim()).toBe('Locataires');
    });

    it('styles the current page with weight and an indicator bar, not by colour alone', async () => {
      const { root } = await setup();
      const link = navs(root).sidebar.querySelector('a') as HTMLElement;

      expect(link.className).toContain('aria-[current=page]:font-semibold');
      expect(link.className).toContain('aria-[current=page]:before:bg-accent');
      expect(link.className).toContain('aria-[current=page]:bg-accent-soft');
    });
  });

  describe('mobile usability', () => {
    it('keeps every nav target at least 44 px tall (min-h-11 = 44 px, tabs min-h-14 = 56 px)', async () => {
      const { root } = await setup();
      const { sidebar, tabs } = navs(root);

      for (const link of sidebar.querySelectorAll('a')) {
        expect(link.classList.contains('min-h-11')).toBe(true);
      }
      for (const link of tabs.querySelectorAll('a')) {
        expect(link.classList.contains('min-h-14')).toBe(true);
      }
    });

    it('pads the bottom bar with the safe-area inset, so the home indicator never covers it', async () => {
      const { root } = await setup();

      expect(navs(root).tabs.className).toContain('pb-[env(safe-area-inset-bottom)]');
    });

    it('pads the whole frame with the other safe areas (status bar, landscape notch)', async () => {
      const { root } = await setup();
      const frame = root.querySelector('div') as HTMLElement;

      for (const inset of ['top', 'right', 'left']) {
        expect(frame.className).toContain(`env(safe-area-inset-${inset})`);
      }
    });

    it('truncates long labels with an ellipsis instead of wrapping or overflowing', async () => {
      const { root } = await setup();

      for (const label of root.querySelectorAll('nav a span')) {
        expect(label.classList.contains('truncate')).toBe(true);
      }
    });

    it('scrolls the content on its own, inside the frame', async () => {
      const { root } = await setup();
      const main = root.querySelector('main') as HTMLElement;

      expect(main.classList.contains('overflow-y-auto')).toBe(true);
      expect(main.classList.contains('min-h-0')).toBe(true);
      expect((root.querySelector('div') as HTMLElement).classList.contains('h-dvh')).toBe(true);
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

    it('applies the theme it switches to', async () => {
      const { root, harness } = await setup();
      const toggle = () => root.querySelector('aside app-theme-toggle button') as HTMLButtonElement;

      toggle().click();
      harness.detectChanges();
      expect(document.documentElement.dataset['theme']).toBe('light');
      expect(toggle().textContent).toContain('Thème : Clair');

      toggle().click();
      harness.detectChanges();
      expect(document.documentElement.dataset['theme']).toBe('dark');
      expect(toggle().textContent).toContain('Thème : Sombre');
    });
  });

  describe('skip link', () => {
    it('is the first thing in the page and sends the focus to the content without navigating', async () => {
      const { root, router } = await setup('/locataires');
      document.body.append(root);
      const skip = root.querySelector('a') as HTMLAnchorElement;

      expect(skip.textContent?.trim()).toBe('Aller au contenu principal');
      expect(skip.getAttribute('href')).toBe('#contenu');

      // A plain `#contenu` anchor would navigate to the home page (`<base href="/">`): it must be cancelled.
      const click = new MouseEvent('click', { bubbles: true, cancelable: true });
      skip.dispatchEvent(click);

      expect(click.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(root.querySelector('main#contenu'));
      expect(router.url).toBe('/locataires');
      root.remove();
    });
  });
});
