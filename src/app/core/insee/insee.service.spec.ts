import { TestBed } from '@angular/core/testing';
import ilat from './fixtures/ilat.xml';
import ilc from './fixtures/ilc.xml';
import irl from './fixtures/irl.xml';
import {
  INSEE_TIMEOUT_MS,
  InseeService,
  InseeUnavailableError,
  parseObservations,
} from './insee.service';

function answer(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'application/xml' } });
}

/** `fetch` answering the fixture of the series asked for, and counting the calls. */
function stubFetch(handler?: (url: string) => Response | Promise<Response>) {
  const urls: string[] = [];
  const fixtures: Record<string, string> = {
    '001617112': ilat,
    '001515333': irl,
    '001532540': ilc,
  };
  const fetchMock = vi.fn(async (url: string) => {
    urls.push(url);
    if (handler) {
      return handler(url);
    }
    const id = /SERIES_BDM\/(\d+)\?/.exec(url)?.[1] ?? '';
    return answer(fixtures[id] ?? '');
  });
  vi.stubGlobal('fetch', fetchMock);
  return { urls, fetchMock };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('parseObservations (recorded-shape fixtures)', () => {
  it('reads the ILAT quarters: 2026-Q2 is 138.01', () => {
    const map = parseObservations(ilat);
    expect(map.get('2026-Q2')).toBe(138.01);
    expect(map.get('2025-Q2')).toBe(133.69);
    expect(map.size).toBe(12);
  });

  it('reads IRL and ILC', () => {
    expect(parseObservations(irl).get('2025-Q1')).toBe(145.47);
    expect(parseObservations(ilc).get('2026-Q1')).toBe(138.12);
    expect(parseObservations(ilc).has('2026-Q2')).toBe(false);
  });

  it('reads a series with a single observation', () => {
    const xml = `<m:StructureSpecificData xmlns:m="urn:x"><m:DataSet><Series IDBANK="1"><Obs TIME_PERIOD="2026-Q2" OBS_VALUE="138.01"/></Series></m:DataSet></m:StructureSpecificData>`;
    expect([...parseObservations(xml)]).toEqual([['2026-Q2', 138.01]]);
  });

  it('skips lines without a usable quarter or value, and refuses a document without any', () => {
    const xml = `<m:StructureSpecificData xmlns:m="urn:x"><m:DataSet><Series>
      <Obs TIME_PERIOD="2026-Q2" OBS_VALUE="138.01"/><Obs TIME_PERIOD="2026-Q1" OBS_VALUE="NaN"/>
      <Obs TIME_PERIOD="2025" OBS_VALUE="130"/><Obs TIME_PERIOD="2025-Q4"/><Obs TIME_PERIOD="2025-Q3" OBS_VALUE="0"/>
      </Series></m:DataSet></m:StructureSpecificData>`;
    expect([...parseObservations(xml).keys()]).toEqual(['2026-Q2']);
    expect(() => parseObservations('<html>Bad gateway</html>')).toThrow(InseeUnavailableError);
    expect(() => parseObservations('')).toThrow(InseeUnavailableError);
  });
});

describe('InseeService', () => {
  it('asks the public BDM series of the family, with no key, and parses the answer', async () => {
    const { urls, fetchMock } = stubFetch();
    const map = await TestBed.inject(InseeService).observations('ILAT');
    expect(map.get('2026-Q2')).toBe(138.01);
    expect(urls).toEqual([
      'https://api.insee.fr/series/BDM/V1/data/SERIES_BDM/001617112?lastNObservations=12',
    ]);
    const init = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.stringify(init[1].headers)).not.toMatch(/key|authorization|bearer/i);
  });

  it('fetches once per family and per session', async () => {
    const { urls } = stubFetch();
    const service = TestBed.inject(InseeService);
    const [a, b] = await Promise.all([service.observations('IRL'), service.observations('IRL')]);
    await service.observations('IRL');
    await service.observations('ILC');
    expect(a).toBe(b);
    expect(urls.map((u) => /SERIES_BDM\/(\d+)/.exec(u)?.[1])).toEqual(['001515333', '001532540']);
  });

  it('does not keep a failure: the next call asks again', async () => {
    let call = 0;
    const { urls } = stubFetch(() => (++call === 1 ? answer('oops', 503) : answer(ilat)));
    const service = TestBed.inject(InseeService);
    await expect(service.observations('ILAT')).rejects.toBeInstanceOf(InseeUnavailableError);
    expect((await service.observations('ILAT')).get('2026-Q2')).toBe(138.01);
    expect(urls.length).toBe(2);
  });

  it('turns a network error and a refused document into a simple French message, never about a key', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    const service = TestBed.inject(InseeService);
    const error = await service.observations('IRL').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InseeUnavailableError);
    expect((error as Error).message).toMatch(/indices INSEE/);
    expect((error as Error).message).not.toMatch(/cl[ée]|api/i);
    stubFetch(() => answer('<html>nope</html>'));
    const other = await TestBed.inject(InseeService)
      .observations('ILC')
      .catch((e: unknown) => e);
    expect(other).toBeInstanceOf(InseeUnavailableError);
    expect((other as InseeUnavailableError).reason).toBe('format');
  });

  it('gives up when INSEE does not answer in time', async () => {
    vi.useFakeTimers();
    // A fetch that never answers, and only fails when its request is aborted.
    vi.stubGlobal(
      'fetch',
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')));
        }),
    );
    const failure = TestBed.inject(InseeService)
      .observations('IRL')
      .catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(INSEE_TIMEOUT_MS + 1);
    const error = await failure;
    expect(error).toBeInstanceOf(InseeUnavailableError);
    expect((error as InseeUnavailableError).reason).toBe('timeout');
  });
});
