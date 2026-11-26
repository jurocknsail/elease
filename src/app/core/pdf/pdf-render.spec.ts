import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import { DEFAULT_LANDLORD_PROFILE } from '../models/landlord-profile';
import { Lease } from '../models/lease';
import { awaitCallback, createEngineLoader, PdfRenderError, renderPdf } from './pdf-render';
import { buildRentCallDefinition } from './rent-call-definition';

/*
 * These specs run the real pdfmake (0.2.x) and its bundled Roboto fonts, in the Vitest/jsdom
 * environment: nothing is mocked. The first render also loads the library (a large lazy chunk in the
 * application), hence the generous timeout.
 */
const RENDER_TIMEOUT_MS = 30000;

function lease(overrides: Partial<Lease> = {}): Lease {
  return {
    isPro: true,
    name: 'Local commercial',
    lot: 3,
    streetNumber: 7,
    streetName: "rue de l'Hôtel-de-Ville",
    optionalAddressInfo: 'Résidence Éden',
    postalCode: 13600,
    city: 'La Ciotat',
    price: 1234,
    charge: 123,
    additionalCharges: [{ title: 'Taxe foncière', amount: 50 }],
    lastSendDate: 0,
    renewalDate: null,
    ...overrides,
  };
}

function definitionFor(l: Lease): TDocumentDefinitions {
  return buildRentCallDefinition({
    leaseholder: { name: 'Agi Martin', email: 'locataire@example.test', phone: '', leases: [l] },
    lease: l,
    profile: DEFAULT_LANDLORD_PROFILE,
    callDate: new Date(2026, 11, 25),
    now: new Date(2026, 10, 26),
  });
}

/** The raw bytes of a Blob as a latin1 string (enough to read the PDF structure). */
async function blobToBinaryString(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let result = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    result += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return result;
}

function pageCount(pdf: string): number {
  const pages = pdf.match(/\/Type \/Page(?![s\w])/g)?.length ?? 0;
  const declared = Number(/\/Count (\d+)/.exec(pdf)?.[1]);
  expect(declared).toBe(pages);
  return pages;
}

describe('renderPdf', () => {
  it(
    'renders a real one-page PDF: blob and base64 carry the same bytes',
    async () => {
      const { blob, base64 } = await renderPdf(definitionFor(lease()));

      expect(blob.type).toBe('application/pdf');
      expect(blob.size).toBeGreaterThan(2000);
      expect(base64).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);

      const fromBlob = await blobToBinaryString(blob);
      expect(fromBlob.startsWith('%PDF-')).toBe(true);
      expect(fromBlob.trimEnd().endsWith('%%EOF')).toBe(true);
      expect(pageCount(fromBlob)).toBe(1);
      // The e-mail attachment (base64) is exactly the file the user previews (blob).
      expect(atob(base64)).toBe(fromBlob);
    },
    RENDER_TIMEOUT_MS,
  );

  it(
    'renders the incomplete real-data lease (no renewal date, lot, charge nor additional charge)',
    async () => {
      const incomplete = lease({
        isPro: false,
        name: 'Cave',
        lot: null,
        charge: null,
        renewalDate: null,
        additionalCharges: [],
        optionalAddressInfo: '',
        price: 120,
      });
      const { blob } = await renderPdf(definitionFor(incomplete));
      const pdf = await blobToBinaryString(blob);
      expect(pdf.startsWith('%PDF-')).toBe(true);
      expect(pageCount(pdf)).toBe(1);
    },
    RENDER_TIMEOUT_MS,
  );

  it(
    'does not modify the definition it is given (pdfmake itself rewrites its input)',
    async () => {
      const def = definitionFor(lease());
      const before = JSON.stringify(def);
      await renderPdf(def);
      expect(JSON.stringify(def)).toBe(before);
    },
    RENDER_TIMEOUT_MS,
  );

  it(
    'renders the same definition twice and several definitions at once',
    async () => {
      const def = definitionFor(lease());
      const [first, second, third] = await Promise.all([
        renderPdf(def),
        renderPdf(def),
        renderPdf(definitionFor(lease({ name: 'Studio', isPro: false }))),
      ]);
      for (const { blob } of [first, second, third]) {
        expect((await blobToBinaryString(blob)).startsWith('%PDF-')).toBe(true);
      }
      // A later render reuses the loaded library.
      const again = await renderPdf(def);
      expect(again.blob.size).toBeGreaterThan(2000);
    },
    RENDER_TIMEOUT_MS,
  );

  it(
    'rejects with a PdfRenderError for an invalid definition',
    async () => {
      const invalid = null as unknown as TDocumentDefinitions;
      await expect(renderPdf(invalid)).rejects.toBeInstanceOf(PdfRenderError);
    },
    RENDER_TIMEOUT_MS,
  );
});

describe('awaitCallback (guard against pdfmake callbacks that never fire)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves with the value handed to the callback and clears its timer', async () => {
    const promise = awaitCallback<string>((done) => done('ok'), 1000);
    await expect(promise).resolves.toBe('ok');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('resolves when the callback fires later, before the delay', async () => {
    const promise = awaitCallback<number>((done) => {
      setTimeout(() => done(42), 500);
    }, 1000);
    await vi.advanceTimersByTimeAsync(500);
    await expect(promise).resolves.toBe(42);
  });

  it('rejects with a PdfRenderError when the callback never fires', async () => {
    const promise = awaitCallback<string>(() => undefined, 1000);
    const assertion = expect(promise).rejects.toBeInstanceOf(PdfRenderError);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it('rejects with a PdfRenderError, keeping the cause, when starting throws', async () => {
    const cause = new Error('boom');
    const promise = awaitCallback<string>(() => {
      throw cause;
    }, 1000);
    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PdfRenderError);
    expect((error as PdfRenderError).cause).toBe(cause);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('createEngineLoader (lazy, load-once, retry after a failed load)', () => {
  const FONTS = { 'Roboto-Regular.ttf': 'AAEA' };
  const createPdf = () => {
    throw new Error('not used');
  };

  it('imports each module once, however many times and however concurrently it is asked', async () => {
    const importPdfMake = vi.fn(() => Promise.resolve({ createPdf }));
    const importFonts = vi.fn(() => Promise.resolve(FONTS));
    const load = createEngineLoader(importPdfMake, importFonts);

    expect(importPdfMake).not.toHaveBeenCalled(); // nothing is imported before the first render
    const [a, b] = await Promise.all([load(), load()]);
    const c = await load();

    expect(importPdfMake).toHaveBeenCalledTimes(1);
    expect(importFonts).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(a).toBe(c);
    expect(a.vfs).toBe(FONTS);
  });

  it('reads CommonJS namespaces (members under `default`) and plain ES modules alike', async () => {
    const commonJs = createEngineLoader(
      () => Promise.resolve({ default: { createPdf } }),
      () => Promise.resolve({ default: FONTS }),
    );
    const engine = await commonJs();
    expect(engine.createPdf).toBe(createPdf);
    expect(engine.vfs).toBe(FONTS);

    const esModule = createEngineLoader(
      () => Promise.resolve({ createPdf }),
      () => Promise.resolve(FONTS),
    );
    expect((await esModule()).createPdf).toBe(createPdf);
  });

  it('forgets a failed import and tries again on the next call', async () => {
    const failure = new TypeError('Failed to fetch dynamically imported module');
    const importPdfMake = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValue({ createPdf });
    const importFonts = vi.fn(() => Promise.resolve(FONTS));
    const load = createEngineLoader(importPdfMake, importFonts);

    const error = await load().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PdfRenderError);
    expect((error as PdfRenderError).cause).toBe(failure);

    await expect(load()).resolves.toMatchObject({ vfs: FONTS });
    expect(importPdfMake).toHaveBeenCalledTimes(2);
    // Once loaded, it stays loaded.
    await load();
    expect(importPdfMake).toHaveBeenCalledTimes(2);
  });

  it('rejects when the font file is missing (pdfmake would hang instead) and allows a retry', async () => {
    const importFonts = vi
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce({ 'Other.ttf': 'AAEA' })
      .mockResolvedValue(FONTS);
    const load = createEngineLoader(() => Promise.resolve({ createPdf }), importFonts);

    await expect(load()).rejects.toBeInstanceOf(PdfRenderError);
    await expect(load()).resolves.toMatchObject({ vfs: FONTS });
  });
});
