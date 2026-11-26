import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  InjectionToken,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';

/**
 * pdf.js, loaded on first use only: the library (and its worker) weigh more than the whole
 * application, so the import is dynamic and nothing else may import `pdfjs-dist`. The « legacy »
 * build is used for the iPhones and older browsers the app targets (the default build needs very
 * recent JavaScript); its worker is copied to `assets/pdfjs/` by angular.json and must come from the
 * same installed version as this module.
 */
type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
type PdfLoadingTask = ReturnType<PdfJs['getDocument']>;
type PdfDocument = Awaited<PdfLoadingTask['promise']>;
type PdfRenderTask = ReturnType<Awaited<ReturnType<PdfDocument['getPage']>>['render']>;

/** Loads pdf.js. Specs replace it with a fake: no worker, no network. */
export const PDFJS_LOADER = new InjectionToken<() => Promise<PdfJs>>('PDFJS_LOADER', {
  providedIn: 'root',
  factory: () => () => import('pdfjs-dist/legacy/build/pdf.mjs'),
});

const WORKER_PATH = 'assets/pdfjs/pdf.worker.min.mjs';
/** Space kept on each side of a page inside the scroll area, in CSS pixels. */
const PAGE_GUTTER = 16;
/** Narrowest width a page is laid out at (the area may measure 0 while it is hidden). */
const MIN_PAGE_WIDTH = 200;
/** iOS Safari refuses canvases beyond about 16.7 million pixels. */
const MAX_CANVAS_PIXELS = 16_000_000;
const RESIZE_DELAY_MS = 150;

type ViewerState = 'empty' | 'loading' | 'ready' | 'error';

/**
 * Shows a PDF blob: EVERY page is drawn with pdf.js onto its own canvas, fitted to the width of the
 * area, at the device's pixel density. The same code path serves the desktop and the phone (an iframe
 * shows only the first page on iOS). The area scrolls and can be focused with the keyboard.
 *
 * Whatever happens, « Ouvrir dans un onglet » stays available (a `blob:` link) while there is a blob:
 * if the preview cannot be drawn, the user can still read the very same file.
 *
 * Cleanup: when the blob changes or the component is destroyed, running render tasks are cancelled,
 * the document and its worker are destroyed, every canvas is emptied and removed and every object URL
 * is revoked. A late answer for a previous blob is ignored (run counter).
 */
@Component({
  selector: 'app-pdf-viewer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex h-full min-h-0 flex-col' },
  template: `
    <div class="flex min-h-9 shrink-0 items-center justify-between gap-3 pb-2 text-sm">
      <span class="truncate text-muted" aria-live="polite">{{ progressLabel() }}</span>
      @if (openUrl(); as url) {
        <a
          [href]="url"
          target="_blank"
          rel="noopener"
          class="shrink-0 rounded font-semibold whitespace-nowrap text-accent underline underline-offset-2"
          >Ouvrir dans un onglet</a
        >
      }
    </div>
    <div
      #area
      role="region"
      aria-label="Aperçu du PDF"
      tabindex="0"
      [attr.aria-busy]="state() === 'loading'"
      class="relative min-h-0 flex-1 overflow-auto rounded-xl border border-border bg-surface"
    >
      @switch (state()) {
        @case ('loading') {
          <p role="status" class="p-6 text-sm text-muted">Chargement de l'aperçu…</p>
        }
        @case ('error') {
          <div role="alert" class="p-6 text-sm">
            <p class="font-semibold">Impossible d'afficher l'aperçu</p>
            <p class="mt-1 text-muted">
              Vous pouvez tout de même lire ce PDF avec « Ouvrir dans un onglet ».
            </p>
          </div>
        }
        @case ('empty') {
          <p class="p-6 text-sm text-muted">Aucun aperçu à afficher.</p>
        }
      }
      <div
        #pages
        class="flex flex-col items-center gap-4 p-4"
        [attr.hidden]="state() === 'ready' ? null : ''"
      ></div>
    </div>
  `,
})
export class PdfViewer {
  /** The PDF to show, or null for none. */
  readonly blob = input<Blob | null>(null);

  private readonly loadPdfJs = inject(PDFJS_LOADER);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly area = viewChild.required<ElementRef<HTMLElement>>('area');
  private readonly pagesHost = viewChild.required<ElementRef<HTMLElement>>('pages');

  protected readonly state = signal<ViewerState>('empty');
  private readonly objectUrl = signal<string | null>(null);
  private readonly pageCount = signal(0);
  private readonly drawn = signal(0);

  /** The link of the fallback: a `blob:` URL is not a user-typed URL, it is trusted explicitly. */
  protected readonly openUrl = computed<SafeUrl | null>(() => {
    const url = this.objectUrl();
    return url ? this.sanitizer.bypassSecurityTrustUrl(url) : null;
  });

  protected readonly progressLabel = computed(() => {
    const total = this.pageCount();
    if (this.state() !== 'ready' && this.state() !== 'loading') {
      return '';
    }
    if (total === 0) {
      return '';
    }
    const plural = total === 1 ? 'page' : 'pages';
    return this.drawn() < total
      ? `Rendu de la page ${this.drawn() + 1} sur ${total}…`
      : `${total} ${plural}`;
  });

  /** Incremented at every new blob and at destruction: older asynchronous work stops silently. */
  private run = 0;
  /** Incremented at every layout pass (new blob, new width): older drawing stops silently. */
  private layoutRun = 0;
  private task: PdfLoadingTask | null = null;
  private doc: PdfDocument | null = null;
  private readonly renderTasks = new Set<PdfRenderTask>();
  private observer: ResizeObserver | null = null;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private laidOutWidth = 0;

  constructor() {
    effect(() => {
      const blob = this.blob();
      untracked(() => void this.show(blob));
    });
    inject(DestroyRef).onDestroy(() => {
      this.run += 1;
      this.layoutRun += 1;
      this.release();
    });
  }

  private async show(blob: Blob | null): Promise<void> {
    this.release();
    const run = (this.run += 1);
    if (!blob) {
      this.state.set('empty');
      return;
    }
    this.objectUrl.set(this.createUrl(blob));
    this.state.set('loading');
    try {
      const [pdfjs, buffer] = await Promise.all([this.loadPdfJs(), blob.arrayBuffer()]);
      if (run !== this.run) {
        return;
      }
      this.configureWorker(pdfjs);
      const task = pdfjs.getDocument({ data: new Uint8Array(buffer) });
      this.task = task;
      const doc = await task.promise;
      if (run !== this.run) {
        void task.destroy().catch(() => undefined);
        return;
      }
      this.doc = doc;
      this.pageCount.set(doc.numPages);
      this.watchWidth(run);
      await this.layout(run);
    } catch {
      if (run !== this.run) {
        return;
      }
      this.state.set('error');
    }
  }

  /**
   * Draws every page, one after the other, at the current width of the area. The first page shows as
   * soon as it is drawn. A newer layout pass (resize) or a newer blob stops this one.
   */
  private async layout(run: number): Promise<void> {
    const doc = this.doc;
    if (!doc) {
      return;
    }
    const pass = (this.layoutRun += 1);
    this.cancelRenders();
    this.clearPages();
    this.drawn.set(0);
    const cssWidth = this.measureWidth();
    this.laidOutWidth = this.areaWidth();
    const stale = () => run !== this.run || pass !== this.layoutRun;
    try {
      for (let number = 1; number <= doc.numPages; number += 1) {
        const page = await doc.getPage(number);
        if (stale()) {
          return;
        }
        const base = page.getViewport({ scale: 1 });
        const cssScale = cssWidth / base.width;
        let outputScale = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
        const pixels = cssWidth * outputScale * base.height * cssScale * outputScale;
        if (pixels > MAX_CANVAS_PIXELS) {
          outputScale = Math.max(1, outputScale * Math.sqrt(MAX_CANVAS_PIXELS / pixels));
        }
        const viewport = page.getViewport({ scale: cssScale * outputScale });

        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${Math.round(base.height * cssScale)}px`;
        canvas.className = 'block max-w-none bg-white shadow-md ring-1 ring-black/10';
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', `Page ${number} sur ${doc.numPages} de l'aperçu du PDF`);
        this.pagesHost().nativeElement.appendChild(canvas);

        const renderTask = page.render({ canvas, viewport });
        this.renderTasks.add(renderTask);
        try {
          await renderTask.promise;
        } finally {
          this.renderTasks.delete(renderTask);
        }
        if (stale()) {
          return;
        }
        this.drawn.set(number);
        this.state.set('ready');
        page.cleanup();
      }
    } catch {
      if (stale()) {
        // Cancelled on purpose (a newer pass or blob started): not a failure.
        return;
      }
      this.state.set('error');
    }
  }

  private areaWidth(): number {
    return this.area().nativeElement.clientWidth;
  }

  /** CSS width a page is drawn at: the area minus its gutters. */
  private measureWidth(): number {
    return Math.max(MIN_PAGE_WIDTH, Math.floor(this.areaWidth() - 2 * PAGE_GUTTER));
  }

  /** Draws the pages again when the area changes width (window resize, rotation, panel change). */
  private watchWidth(run: number): void {
    if (this.observer || typeof ResizeObserver === 'undefined') {
      return;
    }
    this.observer = new ResizeObserver(() => {
      if (this.resizeTimer !== null) {
        clearTimeout(this.resizeTimer);
      }
      this.resizeTimer = setTimeout(() => {
        this.resizeTimer = null;
        if (run === this.run && Math.abs(this.areaWidth() - this.laidOutWidth) > 1) {
          void this.layout(run);
        }
      }, RESIZE_DELAY_MS);
    });
    this.observer.observe(this.area().nativeElement);
  }

  private configureWorker(pdfjs: PdfJs): void {
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(WORKER_PATH, document.baseURI).href;
    }
  }

  private createUrl(blob: Blob): string | null {
    try {
      return URL.createObjectURL(blob);
    } catch {
      return null;
    }
  }

  private cancelRenders(): void {
    for (const renderTask of this.renderTasks) {
      renderTask.cancel();
    }
    this.renderTasks.clear();
  }

  /** Empties and removes every canvas: their pixel buffers are freed at once, not at the next GC. */
  private clearPages(): void {
    const host = this.pagesHost().nativeElement;
    for (const canvas of Array.from(host.querySelectorAll('canvas'))) {
      canvas.width = 0;
      canvas.height = 0;
      canvas.remove();
    }
  }

  /** Frees everything held for the current blob. Safe to call at any time, any number of times. */
  private release(): void {
    this.layoutRun += 1;
    this.cancelRenders();
    if (this.resizeTimer !== null) {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = null;
    }
    this.observer?.disconnect();
    this.observer = null;
    try {
      this.clearPages();
    } catch {
      // The view is already gone (the component is being destroyed).
    }
    if (this.task) {
      // Destroys the document and its worker.
      void this.task.destroy().catch(() => undefined);
    }
    this.task = null;
    this.doc = null;
    const url = this.objectUrl();
    if (url) {
      URL.revokeObjectURL(url);
    }
    this.objectUrl.set(null);
    this.pageCount.set(0);
    this.drawn.set(0);
  }
}
