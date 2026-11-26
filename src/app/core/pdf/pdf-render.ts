import type { TDocumentDefinitions, TFontDictionary } from 'pdfmake/interfaces';

/** A rendered PDF: the file to preview or save, and the same bytes in base64 for the e-mail attachment. */
export interface RenderedPdf {
  blob: Blob;
  base64: string;
}

/** The PDF could not be produced (library not loadable, invalid definition, or no answer in time). */
export class PdfRenderError extends Error {
  constructor(message = 'La génération du PDF a échoué.', options?: ErrorOptions) {
    super(message, options);
    this.name = 'PdfRenderError';
  }
}

/** A rent-call PDF is a few tens of kilobytes: it renders in well under a second. */
const RENDER_TIMEOUT_MS = 30000;

type PdfMakeModule = typeof import('pdfmake/build/pdfmake');

export interface PdfEngine {
  createPdf: PdfMakeModule['createPdf'];
  vfs: Record<string, string>;
}

/** The default font of pdfmake, which the PDF definition does not override. */
const FONT_FILE = 'Roboto-Regular.ttf';

/** Fresh on every render: pdfmake rewrites the font entries it is given. */
function roboto(): TFontDictionary {
  return {
    Roboto: {
      normal: 'Roboto-Regular.ttf',
      bold: 'Roboto-Medium.ttf',
      italics: 'Roboto-Italic.ttf',
      bolditalics: 'Roboto-MediumItalic.ttf',
    },
  };
}

/**
 * The value of a CommonJS module imported dynamically: bundlers expose it as `default` (and copy its
 * members onto the namespace), Node's ESM loader only as `default`; a real ES module has no `default`.
 */
function moduleValue<T>(namespace: unknown): T {
  return ((namespace as { default?: unknown }).default ?? namespace) as T;
}

/**
 * Builds the function that loads pdfmake and its fonts once and hands them out. A failed load
 * (offline, chunk gone after an update) is forgotten so that the next render tries again.
 */
export function createEngineLoader(
  importPdfMake: () => Promise<unknown>,
  importFonts: () => Promise<unknown>,
): () => Promise<PdfEngine> {
  let engine: Promise<PdfEngine> | undefined;
  return () => {
    if (!engine) {
      const loading = Promise.all([importPdfMake(), importFonts()])
        .then(([pdfMakeModule, fontsModule]) => {
          const vfs = moduleValue<Record<string, string>>(fontsModule);
          if (typeof vfs[FONT_FILE] !== 'string') {
            // Without its font pdfmake would throw inside a callback and never answer.
            throw new PdfRenderError('Les polices du PDF sont introuvables.');
          }
          return { createPdf: moduleValue<PdfMakeModule>(pdfMakeModule).createPdf, vfs };
        })
        .catch((error: unknown) => {
          throw error instanceof PdfRenderError
            ? error
            : new PdfRenderError("Le module de génération du PDF n'a pas pu être chargé.", {
                cause: error,
              });
        });
      engine = loading;
      loading.catch(() => {
        if (engine === loading) {
          engine = undefined;
        }
      });
    }
    return engine;
  };
}

/**
 * pdfmake and its fonts weigh more than the rest of the application together: they are loaded on
 * the first render only. The dynamic `import()` calls make the bundler emit them as separate lazy
 * chunks; they must stay literal here and nowhere else may import `pdfmake`.
 */
const loadEngine = createEngineLoader(
  () => import('pdfmake/build/pdfmake'),
  () => import('pdfmake/build/vfs_fonts'),
);

/**
 * Runs a callback-style operation as a promise. pdfmake 0.2 reports a failure that happens after
 * it started (bad definition, missing font) as an unhandled rejection and never calls back: without
 * the delay the screen would wait forever. Rejects with a `PdfRenderError` if `start` throws or if
 * `done` is not called within `timeoutMs`.
 */
export function awaitCallback<T>(
  start: (done: (value: T) => void) => void,
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new PdfRenderError('La génération du PDF ne répond pas.')),
      timeoutMs,
    );
    try {
      start((value) => {
        clearTimeout(timer);
        resolve(value);
      });
    } catch (error) {
      clearTimeout(timer);
      reject(new PdfRenderError('La génération du PDF a échoué.', { cause: error }));
    }
  });
}

/** The base64 of a blob, without the `data:` prefix. */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : '';
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.onerror = () =>
      reject(new PdfRenderError('La lecture du PDF a échoué.', { cause: reader.error }));
    reader.readAsDataURL(blob);
  });
}

/**
 * Renders a PDF definition with pdfmake (loaded on first use). The PDF is produced ONCE: the base64
 * is read from the very blob, so the file that is previewed and the one attached to the e-mail are
 * the same bytes. The definition is copied first because pdfmake rewrites the object it is given.
 * The definition must be plain data (no functions), as the one of `buildRentCallDefinition` is.
 */
export async function renderPdf(
  def: TDocumentDefinitions,
  timeoutMs = RENDER_TIMEOUT_MS,
): Promise<RenderedPdf> {
  const { createPdf, vfs } = await loadEngine();
  const blob = await awaitCallback<Blob>((done) => {
    createPdf(structuredClone(def), {}, roboto(), vfs).getBlob(done);
  }, timeoutMs);
  return { blob, base64: await blobToBase64(blob) };
}
