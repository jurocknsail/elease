import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PDFJS_LOADER, PdfViewer } from './pdf-viewer';

/*
 * jsdom cannot draw a PDF: pdf.js is replaced by a fake that records what it is asked, so these
 * specs cover the viewer's own job (every page, labels, states, cleanup). The real rendering is
 * checked in a browser.
 */

interface FakeRender {
  canvas: HTMLCanvasElement;
  cancelled: boolean;
  finish: () => void;
  fail: (error: unknown) => void;
}

class FakePdfJs {
  readonly renders: FakeRender[] = [];
  readonly destroyed: number[] = [];
  readonly GlobalWorkerOptions: { workerSrc: string } = { workerSrc: '' };
  pages = 2;
  /** When true, pages render only when the spec calls `finish()`. */
  manual = false;
  loadError: unknown = null;
  getDocumentCalls = 0;
  private tasks = 0;

  getDocument = (_source: unknown) => {
    this.getDocumentCalls += 1;
    const id = (this.tasks += 1);
    const error = this.loadError;
    const doc = {
      numPages: this.pages,
      getPage: (n: number) =>
        Promise.resolve({
          getViewport: ({ scale }: { scale: number }) => ({
            width: 600 * scale,
            height: 800 * scale,
          }),
          render: ({ canvas }: { canvas: HTMLCanvasElement }) => {
            let resolve!: () => void;
            let reject!: (e: unknown) => void;
            const promise = new Promise<void>((res, rej) => {
              resolve = res;
              reject = rej;
            });
            const render: FakeRender = {
              canvas,
              cancelled: false,
              finish: () => resolve(),
              fail: (e) => reject(e),
            };
            this.renders.push(render);
            if (!this.manual) {
              resolve();
            }
            return {
              promise,
              cancel: () => {
                render.cancelled = true;
                reject(new Error('cancelled'));
              },
            };
          },
          cleanup: () => undefined,
          n,
        }),
    };
    return {
      promise: error ? Promise.reject(error) : Promise.resolve(doc),
      destroy: () => {
        this.destroyed.push(id);
        return Promise.resolve();
      },
    };
  };
}

@Component({
  imports: [PdfViewer],
  template: '<app-pdf-viewer [blob]="blob()" />',
})
class Host {
  readonly blob = signal<Blob | null>(null);
}

const pdfBlob = (label = 'a') => new Blob([`%PDF-1.4 ${label}`], { type: 'application/pdf' });

async function flush(fixture: ComponentFixture<Host>) {
  for (let i = 0; i < 30; i++) {
    await Promise.resolve();
    fixture.detectChanges();
  }
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 30; i++) {
    await Promise.resolve();
  }
  fixture.detectChanges();
}

describe('PdfViewer', () => {
  let pdf: FakePdfJs;
  let created: string[];
  let revoked: string[];
  let counter: number;

  beforeEach(() => {
    pdf = new FakePdfJs();
    created = [];
    revoked = [];
    counter = 0;
    URL.createObjectURL = () => {
      const url = `blob:test/${(counter += 1)}`;
      created.push(url);
      return url;
    };
    URL.revokeObjectURL = (url: string) => {
      revoked.push(url);
    };
    TestBed.configureTestingModule({
      providers: [{ provide: PDFJS_LOADER, useValue: () => Promise.resolve(pdf) }],
    });
  });

  function open(blob: Blob | null = pdfBlob()) {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.blob.set(blob);
    fixture.detectChanges();
    return fixture;
  }

  const el = (fixture: ComponentFixture<Host>) => fixture.nativeElement as HTMLElement;
  const canvases = (fixture: ComponentFixture<Host>) => [...el(fixture).querySelectorAll('canvas')];
  const link = (fixture: ComponentFixture<Host>) =>
    el(fixture).querySelector<HTMLAnchorElement>('a[target="_blank"]');

  it('shows a neutral message when there is no blob, and no link', async () => {
    const fixture = open(null);
    await flush(fixture);

    expect(el(fixture).textContent).toContain('Aucun aperçu à afficher.');
    expect(link(fixture)).toBeNull();
    expect(pdf.getDocumentCalls).toBe(0);
  });

  it('draws EVERY page on its own canvas, each with a page label', async () => {
    pdf.pages = 3;
    const fixture = open();
    await flush(fixture);

    const labels = canvases(fixture).map((c) => c.getAttribute('aria-label'));
    expect(labels).toEqual([
      "Page 1 sur 3 de l'aperçu du PDF",
      "Page 2 sur 3 de l'aperçu du PDF",
      "Page 3 sur 3 de l'aperçu du PDF",
    ]);
    expect(canvases(fixture).every((c) => c.getAttribute('role') === 'img')).toBe(true);
    expect(el(fixture).querySelector('[role="status"]')).toBeNull();
  });

  it('points pdf.js at the copied worker, relative to the document base', async () => {
    const fixture = open();
    await flush(fixture);

    expect(pdf.GlobalWorkerOptions.workerSrc).toBe(
      new URL('assets/pdfjs/pdf.worker.min.mjs', document.baseURI).href,
    );
  });

  it('is a keyboard-focusable, named scroll region', async () => {
    const fixture = open();
    await flush(fixture);

    const region = el(fixture).querySelector<HTMLElement>('[role="region"]');
    expect(region?.getAttribute('aria-label')).toBe('Aperçu du PDF');
    expect(region?.tabIndex).toBe(0);
  });

  it('offers « Ouvrir dans un onglet » as a blob link opened safely in a new tab', async () => {
    const fixture = open();
    await flush(fixture);

    const a = link(fixture);
    expect(a?.textContent?.trim()).toBe('Ouvrir dans un onglet');
    expect(a?.getAttribute('href')).toBe(created[0]);
    expect(a?.getAttribute('rel')).toBe('noopener');
    expect(a?.getAttribute('target')).toBe('_blank');
  });

  it('shows a loading state (busy, announced) until the first page is drawn', async () => {
    pdf.manual = true;
    const fixture = open();
    await flush(fixture);

    expect(el(fixture).querySelector('[role="status"]')?.textContent).toContain('Chargement');
    expect(el(fixture).querySelector('[aria-busy="true"]')).not.toBeNull();

    pdf.renders[0].finish();
    await flush(fixture);

    expect(el(fixture).querySelector('[role="status"]')).toBeNull();
    expect(el(fixture).querySelector('[aria-busy="true"]')).toBeNull();
  });

  describe('failure', () => {
    it("shows « Impossible d'afficher l'aperçu » and the link still works", async () => {
      pdf.loadError = new Error('invalid pdf');
      const fixture = open();
      await flush(fixture);

      const alert = el(fixture).querySelector('[role="alert"]');
      expect(alert?.textContent).toContain("Impossible d'afficher l'aperçu");
      expect(canvases(fixture)).toHaveLength(0);
      expect(link(fixture)?.getAttribute('href')).toBe(created[0]);
    });

    it('shows the same error when a page fails to render', async () => {
      pdf.manual = true;
      const fixture = open();
      await flush(fixture);
      pdf.renders[0].fail(new Error('render'));
      await flush(fixture);

      expect(el(fixture).querySelector('[role="alert"]')).not.toBeNull();
    });

    it('shows the error when pdf.js itself cannot be loaded', async () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [{ provide: PDFJS_LOADER, useValue: () => Promise.reject(new Error('chunk')) }],
      });
      const fixture = open();
      await flush(fixture);

      expect(el(fixture).querySelector('[role="alert"]')).not.toBeNull();
      expect(link(fixture)).not.toBeNull();
    });
  });

  describe('cleanup', () => {
    it('a new blob cancels the running renders, destroys the document, revokes the old URL', async () => {
      pdf.manual = true;
      const fixture = open(pdfBlob('one'));
      await flush(fixture);
      const first = pdf.renders[0];

      pdf.manual = false;
      fixture.componentInstance.blob.set(pdfBlob('two'));
      fixture.detectChanges();
      await flush(fixture);

      expect(first.cancelled).toBe(true);
      expect(pdf.destroyed).toContain(1);
      expect(revoked).toEqual([created[0]]);
      expect(link(fixture)?.getAttribute('href')).toBe(created[1]);
      expect(canvases(fixture)).toHaveLength(2);
      // The canvas of the first blob was emptied before it was removed.
      expect(first.canvas.width).toBe(0);
      expect(first.canvas.isConnected).toBe(false);
    });

    it('a late answer for the previous blob never draws', async () => {
      pdf.manual = true;
      const fixture = open(pdfBlob('one'));
      await flush(fixture);
      const stale = pdf.renders[0];

      pdf.manual = false;
      fixture.componentInstance.blob.set(pdfBlob('two'));
      fixture.detectChanges();
      await flush(fixture);
      stale.finish();
      await flush(fixture);

      expect(canvases(fixture).every((c) => c !== stale.canvas)).toBe(true);
      expect(canvases(fixture)).toHaveLength(2);
    });

    it('destroying the component revokes the URL, cancels renders, destroys the document and frees canvases', async () => {
      pdf.manual = true;
      const fixture = open();
      await flush(fixture);
      const render = pdf.renders[0];

      fixture.destroy();

      expect(render.cancelled).toBe(true);
      expect(revoked).toEqual([created[0]]);
      expect(pdf.destroyed).toEqual([1]);
      expect(render.canvas.isConnected).toBe(false);
    });

    it('going back to no blob revokes the URL and removes the link and the canvases', async () => {
      const fixture = open();
      await flush(fixture);

      fixture.componentInstance.blob.set(null);
      fixture.detectChanges();
      await flush(fixture);

      expect(revoked).toEqual([created[0]]);
      expect(link(fixture)).toBeNull();
      expect(canvases(fixture)).toHaveLength(0);
    });

    it('opening and closing 30 times leaves no canvas and no object URL behind', async () => {
      for (let i = 0; i < 30; i++) {
        const fixture = open(pdfBlob(String(i)));
        await flush(fixture);
        fixture.destroy();
      }

      expect(created).toHaveLength(30);
      expect([...revoked].sort()).toEqual([...created].sort());
      expect(document.querySelectorAll('canvas')).toHaveLength(0);
      expect(pdf.destroyed).toHaveLength(30);
    });
  });
});
