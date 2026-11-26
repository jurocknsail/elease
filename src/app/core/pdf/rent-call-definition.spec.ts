import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import { DEFAULT_LANDLORD_PROFILE, LandlordProfile } from '../models/landlord-profile';
import { Lease } from '../models/lease';
import { Leaseholder } from '../models/leaseholder';
import { LEGACY_EMAIL_SIGNATURE, legacyDefinition } from './legacy-definition.fixture';
import { buildRentCallDefinition } from './rent-call-definition';

/*
 * The new definition must be identical, key by key, to the legacy one (the fixture is a frozen copy
 * of main:src/app/tab-send/tab-send.page.ts lines 201-306) for the default landlord profile. The only
 * deliberate difference is the postal code, printed with 5 digits (1000 -> 01000), tested apart.
 * Dates are built with local-time constructors so the suite passes in every time zone.
 */

/** Indentation the legacy source embedded in its template literals (header and body: 18; legal text: 20). */
const INDENT_18 = ' '.repeat(18);
const INDENT_20 = ' '.repeat(20);

function lease(overrides: Partial<Lease> = {}): Lease {
  return {
    isPro: false,
    name: 'Appartement',
    lot: 0,
    streetNumber: 12,
    streetName: 'rue des Lilas',
    optionalAddressInfo: '',
    postalCode: 13600,
    city: 'La Ciotat',
    price: 650,
    charge: null,
    additionalCharges: [],
    lastSendDate: 0,
    renewalDate: null,
    ...overrides,
  };
}

function holder(name = 'Agi Martin'): Leaseholder {
  return { name, email: 'locataire@example.test', phone: '', leases: [] };
}

/** (a) professional lease with a charges advance and one additional charge. */
const PRO_WITH_CHARGES = lease({
  isPro: true,
  name: 'Local commercial',
  lot: 3,
  optionalAddressInfo: 'Bâtiment B',
  price: 1234,
  charge: 123,
  additionalCharges: [{ title: 'Taxe foncière', amount: 50 }],
});

/** (b) habitation lease: `charge` null and `lot` 0. */
const HABITATION_NO_CHARGE = lease({ name: 'Studio', lot: 0, price: 300, charge: null });

/** (c) empty `optionalAddressInfo`, a lot number and a charges advance. */
const NO_ADDRESS_INFO = lease({
  name: 'Garage n° 13',
  lot: 13,
  optionalAddressInfo: '',
  price: 95.5,
  charge: 15,
});

/** (d) Review Focus: no renewal date, no lot, no charge, no additional charge (5 of 9 real leases). */
const INCOMPLETE = lease({
  name: 'Cave',
  lot: null,
  renewalDate: null,
  charge: null,
  additionalCharges: [],
  price: 120,
});
const INCOMPLETE_PRO = { ...INCOMPLETE, isPro: true };

/** (e) several additional charges with float-ugly amounts. */
const FLOAT_UGLY = lease({
  isPro: true,
  name: 'Local B',
  price: 1234.56,
  charge: 0.1,
  additionalCharges: [
    { title: 'Ordures ménagères', amount: 0.1 },
    { title: 'Eau', amount: 0.2 },
    { title: 'Parking', amount: 0.7 },
    { title: "Régularisation de l'eau", amount: 1.005 },
  ],
});

/** (e) accents and apostrophes in the names, another city, another 5-digit postal code. */
const ACCENTED = lease({
  name: 'Appartement n° 2',
  lot: 2,
  streetNumber: 7,
  streetName: "rue de l'Hôtel-de-Ville",
  optionalAddressInfo: "Résidence l'Éden, escalier B",
  postalCode: 42000,
  city: 'Saint-Étienne',
  price: 780.4,
  charge: 45.9,
  additionalCharges: [{ title: "Taxe d'enlèvement", amount: 12.34 }],
});

/** A charge of 0 prints no "Avance sur charges" line (the legacy tested `!= 0`). */
const ZERO_CHARGE = lease({ isPro: true, name: 'Bureau', price: 500, charge: 0 });

/** What the legacy tolerated at run time although the model forbids it. */
const MISSING_OPTIONALS = {
  ...lease({ name: 'Box', price: 80 }),
  additionalCharges: undefined,
  optionalAddressInfo: null,
} as unknown as Lease;

const FIXTURES: Array<[string, Leaseholder, Lease]> = [
  ['(a) professional lease, charges and an additional charge', holder(), PRO_WITH_CHARGES],
  ['(b) habitation lease, charge null, lot 0', holder(), HABITATION_NO_CHARGE],
  ['(c) empty optionalAddressInfo', holder(), NO_ADDRESS_INFO],
  ['(d) no renewalDate, lot, charge nor additional charge', holder(), INCOMPLETE],
  ['(d) the same, professional', holder(), INCOMPLETE_PRO],
  ['(e) float-ugly additional charges', holder(), FLOAT_UGLY],
  ['(e) accents and apostrophes', holder("Élodie d'Aubigné-Œil"), ACCENTED],
  ['charge 0, professional', holder(), ZERO_CHARGE],
  ['missing additionalCharges / null optionalAddressInfo', holder(), MISSING_OPTIONALS],
];

/** [label, now, callDate]: periods of 28, 29, 30 and 31 days, the year rollover, a call date that is not the 25th. */
const DATES: Array<[string, Date, Date]> = [
  ['25 Nov 2026 -> 12/2026 (31 days)', new Date(2026, 10, 26, 9, 30), new Date(2026, 10, 25)],
  [
    '25 Dec 2026 -> 01/2027 (year rollover)',
    new Date(2026, 11, 20, 23, 59, 59),
    new Date(2026, 11, 25),
  ],
  ['25 Jan 2027 -> 02/2027 (28 days)', new Date(2027, 0, 1, 0, 5), new Date(2027, 0, 25)],
  [
    '25 Jan 2028 -> 02/2028 (leap year, 29 days)',
    new Date(2028, 0, 3, 12, 0),
    new Date(2028, 0, 25),
  ],
  ['25 Mar 2027 -> 04/2027 (30 days)', new Date(2027, 2, 25, 8, 15), new Date(2027, 2, 25)],
  ['3 Feb 2027 -> 03/2027 (not the 25th)', new Date(2027, 1, 3, 18, 45), new Date(2027, 1, 3)],
];

const NOW = new Date(2026, 10, 26, 9, 30);
const DEC_25_2026 = new Date(2026, 11, 25);

function build(
  l: Lease,
  options: { holder?: Leaseholder; profile?: LandlordProfile; callDate?: Date; now?: Date } = {},
): TDocumentDefinitions {
  return buildRentCallDefinition({
    leaseholder: options.holder ?? holder(),
    lease: l,
    profile: options.profile ?? DEFAULT_LANDLORD_PROFILE,
    callDate: options.callDate ?? DEC_25_2026,
    now: options.now ?? NOW,
  });
}

function legacy(
  l: Lease,
  options: { holder?: Leaseholder; callDate?: Date; now?: Date } = {},
): TDocumentDefinitions {
  return legacyDefinition(
    options.holder ?? holder(),
    l,
    options.now ?? NOW,
    options.callDate ?? DEC_25_2026,
  );
}

/** Every string of the definition, in document order. */
function allTexts(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') {
    out.push(node);
  } else if (Array.isArray(node)) {
    node.forEach((child) => allTexts(child, out));
  } else if (node !== null && typeof node === 'object') {
    const record = node as Record<string, unknown>;
    for (const key of ['content', 'columns', 'text']) {
      if (key in record) {
        allTexts(record[key], out);
      }
    }
  }
  return out;
}

const CUSTOM_PROFILE: LandlordProfile = {
  name: 'SCI TEST',
  addressLines: ['1 RUE A', '75001 PARIS'],
  issueCity: 'PARIS',
  legalNotice:
    'SCI TEST au capital de 1000 euros, inscrite au RCS de PARIS sous le n° 123 456 789.',
  emailSignature: 'Jeanne TEST',
};

/** A lease far from the default landlord's town, so legacy landlord values cannot come from the tenant side. */
const FAR_AWAY = lease({
  isPro: true,
  name: 'Atelier',
  lot: 4,
  streetName: 'avenue du Test',
  optionalAddressInfo: 'Bat C',
  postalCode: 13400,
  city: 'Aubagne',
  price: 900,
  charge: 60,
  additionalCharges: [{ title: 'Taxe', amount: 10 }],
});

describe('buildRentCallDefinition', () => {
  describe('identical to the legacy definition with the default landlord profile', () => {
    for (const [fixtureName, h, l] of FIXTURES) {
      for (const [dateName, now, callDate] of DATES) {
        it(`${fixtureName}, ${dateName}`, () => {
          const built = build(l, { holder: h, callDate, now });
          const old = legacy(l, { holder: h, callDate, now });
          // JSON equality: same keys, same order, same strings (whitespace included).
          expect(JSON.stringify(built)).toBe(JSON.stringify(old));
        });
      }
    }

    it('guards the fixture itself: the legacy output of a simple lease is the golden master below', () => {
      // Written out by hand from the legacy output (main:src/app/tab-send/tab-send.page.ts).
      const golden = {
        info: {
          title: '26_11_2026_Agi Martin_Studio',
          author: 'SCI LA CHARINE',
          subject: 'Appel de Loyer',
          keywords: 'LOYER Studio',
        },
        styles: { red: { bold: true, color: '#ff5500' } },
        content: [
          {
            alignment: 'left',
            text: `SCI LA CHARINE\n${INDENT_18}41 CHEMIN DES BAGNOLS\n${INDENT_18}13600 LA CIOTAT`,
          },
          {
            alignment: 'right',
            text: 'AGI MARTIN\n12 RUE DES LILAS\n13600 LA CIOTAT',
          },
          {
            alignment: 'left',
            text: [
              'LA CIOTAT \n Le 25/12/2026',
              { text: '\n\nFACTURE DU LOYER pour Studio', bold: true },
              `\n\n${INDENT_18}Établie par la SCI LA CHARINE`,
            ],
          },
          {
            alignment: 'justify',
            text: [
              { text: 'Période du 01/01/2027 au 31/01/2027', bold: true },
              {
                text:
                  `\n\n${INDENT_18}Madame, Monsieur,\n` +
                  `${INDENT_18}Nous vous prions de recevoir ci-dessous le détail de votre facture concernant le local sis :\n` +
                  INDENT_18,
              },
              { text: 'Studio, 12 rue des Lilas, 13600 LA CIOTAT', italics: true },
              `\n${INDENT_18}\n\n${INDENT_18}`,
            ],
          },
          {
            columns: [
              { text: 'Date \n01/01/2027', bold: true },
              {
                text: [
                  { text: 'Libellé\n', bold: true },
                  'Loyer HT\n',
                  { text: 'Total TTC', bold: true },
                ],
              },
              {
                alignment: 'right',
                text: [
                  { text: 'Montant\n', bold: true },
                  '300.00\n',
                  { text: '300.00€', bold: true },
                ],
              },
            ],
          },
          {
            alignment: 'justify',
            text: [
              { text: '\n\nConditions de règlement :', italics: true },
              {
                text:
                  '\nEn application de la loi n° 92.1482 Du 31/12/92, le règlement anticipé ne donnera pas lieu à escompte.\n' +
                  `${INDENT_20}En cas de réglement après échéance, il sera fait applications des dispositions légales après mise en demeure.\n` +
                  `${INDENT_20}SCI LA CHARINE au capital de 2000 euros, inscrite au RCS de MARSEILLE sous le n° 507 834 117.\n` +
                  `${INDENT_20}\n`,
                italics: true,
              },
            ],
          },
          { alignment: 'justify', text: `\n${INDENT_18}` },
        ],
      };
      expect(JSON.stringify(legacy(HABITATION_NO_CHARGE))).toBe(JSON.stringify(golden));
      expect(JSON.stringify(build(HABITATION_NO_CHARGE))).toBe(JSON.stringify(golden));
    });

    it('does not mutate its arguments', () => {
      const l = structuredClone(PRO_WITH_CHARGES);
      const h = holder();
      const profile = structuredClone(DEFAULT_LANDLORD_PROFILE);
      const callDate = new Date(2026, 11, 25);
      const now = new Date(2026, 10, 26);
      buildRentCallDefinition({ leaseholder: h, lease: l, profile, callDate, now });
      expect(l).toEqual(PRO_WITH_CHARGES);
      expect(h).toEqual(holder());
      expect(profile).toEqual(DEFAULT_LANDLORD_PROFILE);
      expect(callDate).toEqual(new Date(2026, 11, 25));
      expect(now).toEqual(new Date(2026, 10, 26));
    });
  });

  describe('DEFAULT_LANDLORD_PROFILE against the legacy definition', () => {
    const legacyDef = JSON.parse(JSON.stringify(legacy(HABITATION_NO_CHARGE))) as {
      info: { author: string };
      content: Array<{ text: unknown }>;
    };

    it('header block: name and address lines', () => {
      const lines = (legacyDef.content[0].text as string).split('\n').map((line) => line.trim());
      expect(lines).toEqual([
        DEFAULT_LANDLORD_PROFILE.name,
        ...DEFAULT_LANDLORD_PROFILE.addressLines,
      ]);
    });

    it('issue city', () => {
      const issue = (legacyDef.content[2].text as string[])[0];
      expect(issue).toMatch(/^.+ \n Le \d\d\/\d\d\/\d{4}$/);
      expect(issue.split(' \n Le ')[0]).toBe(DEFAULT_LANDLORD_PROFILE.issueCity);
    });

    it('"Établie par la <name>"', () => {
      const text = (legacyDef.content[2].text as string[])[2];
      expect(text.trim()).toBe(`Établie par la ${DEFAULT_LANDLORD_PROFILE.name}`);
    });

    it('PDF author', () => {
      expect(legacyDef.info.author).toBe(DEFAULT_LANDLORD_PROFILE.name);
    });

    it('legal notice (third line of the conditions)', () => {
      const conditions = legacyDef.content[5].text as Array<{ text: string }>;
      const lines = conditions[1].text.split('\n').map((line) => line.trim());
      expect(lines).toContain(DEFAULT_LANDLORD_PROFILE.legalNotice);
      expect(lines[3]).toBe(DEFAULT_LANDLORD_PROFILE.legalNotice);
    });

    it('e-mail signature (legacy mail body, main:src/app/services/parse-service.service.ts:352-357)', () => {
      expect(DEFAULT_LANDLORD_PROFILE.emailSignature).toBe(LEGACY_EMAIL_SIGNATURE);
    });
  });

  describe('landlord data comes only from the profile', () => {
    const customJson = (): string => JSON.stringify(build(FAR_AWAY, { profile: CUSTOM_PROFILE }));

    it('prints the custom profile in the header, the issue place, "Établie par la", the author and the legal text', () => {
      const json = JSON.parse(customJson()) as {
        info: { author: string };
        content: Array<{ text: unknown }>;
      };
      expect(json.content[0].text).toBe(`SCI TEST\n${INDENT_18}1 RUE A\n${INDENT_18}75001 PARIS`);
      expect((json.content[2].text as string[])[0]).toBe('PARIS \n Le 25/12/2026');
      expect((json.content[2].text as string[])[2]).toBe(`\n\n${INDENT_18}Établie par la SCI TEST`);
      expect(json.info.author).toBe('SCI TEST');
      const conditions = json.content[5].text as Array<{ text: string }>;
      expect(conditions[1].text).toContain(
        `\n${INDENT_20}${CUSTOM_PROFILE.legalNotice}\n${INDENT_20}\n`,
      );
    });

    it('is the legacy definition with exactly those five landlord places replaced', () => {
      const expected = JSON.parse(JSON.stringify(legacy(FAR_AWAY))) as {
        info: { author: string };
        content: Array<{ text: unknown }>;
      };
      expected.info.author = CUSTOM_PROFILE.name;
      expected.content[0].text = `SCI TEST\n${INDENT_18}1 RUE A\n${INDENT_18}75001 PARIS`;
      const issue = expected.content[2].text as string[];
      issue[0] = issue[0].replace(DEFAULT_LANDLORD_PROFILE.issueCity, CUSTOM_PROFILE.issueCity);
      issue[2] = issue[2].replace(DEFAULT_LANDLORD_PROFILE.name, CUSTOM_PROFILE.name);
      const conditions = expected.content[5].text as Array<{ text: string }>;
      conditions[1].text = conditions[1].text.replace(
        DEFAULT_LANDLORD_PROFILE.legalNotice,
        CUSTOM_PROFILE.legalNotice,
      );
      expect(customJson()).toBe(JSON.stringify(expected));
    });

    it('leaves no trace of the legacy landlord anywhere', () => {
      for (const legacyValue of [
        'SCI LA CHARINE',
        'CHARINE',
        'LA CIOTAT',
        'CIOTAT',
        'BAGNOLS',
        '41 CHEMIN',
        '507 834 117',
        'MARSEILLE',
        'capital de 2000',
        'Pierre',
        'MARGERIT',
      ]) {
        expect(customJson()).not.toContain(legacyValue);
      }
      // ...while the legacy definition of the same lease does contain them (the scan is meaningful).
      const legacyJson = JSON.stringify(legacy(FAR_AWAY));
      expect(legacyJson).toContain('SCI LA CHARINE');
      expect(legacyJson).toContain('LA CIOTAT');
      expect(legacyJson).toContain('507 834 117');
    });

    it('skips blank address lines and trims the profile texts', () => {
      const def = build(FAR_AWAY, {
        profile: {
          ...CUSTOM_PROFILE,
          name: '  SCI TEST ',
          addressLines: [' 1 RUE A ', '', '   ', '75001 PARIS'],
          issueCity: ' PARIS ',
        },
      });
      expect(JSON.stringify(def)).toBe(customJson());
    });

    it('prints a multi-line legal notice with the legal-text indentation on every line', () => {
      const def = build(FAR_AWAY, {
        profile: { ...CUSTOM_PROFILE, legalNotice: 'Première ligne.\nSeconde ligne.' },
      });
      const texts = allTexts(def);
      expect(texts).toContain(
        `\nEn application de la loi n° 92.1482 Du 31/12/92, le règlement anticipé ne donnera pas lieu à escompte.\n` +
          `${INDENT_20}En cas de réglement après échéance, il sera fait applications des dispositions légales après mise en demeure.\n` +
          `${INDENT_20}Première ligne.\n${INDENT_20}Seconde ligne.\n${INDENT_20}\n`,
      );
    });

    it('omits the legal notice line when the profile has none', () => {
      const def = build(FAR_AWAY, { profile: { ...CUSTOM_PROFILE, legalNotice: '  ' } });
      const conditions = allTexts(def).find((t) => t.includes('En application de la loi'));
      expect(conditions).toBe(
        `\nEn application de la loi n° 92.1482 Du 31/12/92, le règlement anticipé ne donnera pas lieu à escompte.\n` +
          `${INDENT_20}En cas de réglement après échéance, il sera fait applications des dispositions légales après mise en demeure.\n` +
          `${INDENT_20}\n`,
      );
    });
  });

  describe('contents that stay literally as in the legacy', () => {
    it('labels and amounts of a professional lease (VAT on the rent only)', () => {
      const texts = allTexts(build(PRO_WITH_CHARGES));
      expect(texts).toContain('Loyer HT\nT.V.A. 20%\nAvance sur charges\n');
      expect(texts).toContain('Taxe foncière\n');
      expect(texts).toContain('Total TTC');
      // 1234 + VAT 246.80 + charges 123 + 50 = 1653.80
      expect(texts).toContain('1234.00\n246.80\n123.00\n');
      expect(texts).toContain('50.00\n');
      expect(texts).toContain('1653.80€');
    });

    it('prints no VAT line for a habitation lease, even with charges', () => {
      const texts = allTexts(build(lease({ price: 300, charge: 40 })));
      expect(texts).toContain('Loyer HT\nAvance sur charges\n');
      expect(texts).toContain('300.00\n40.00\n');
      expect(texts).toContain('340.00€');
      expect(texts.join('')).not.toContain('T.V.A.');
    });

    it('prints no "Avance sur charges" line when the charge is null or 0', () => {
      for (const charge of [null, 0]) {
        const texts = allTexts(build(lease({ isPro: true, price: 500, charge })));
        expect(texts).toContain('Loyer HT\nT.V.A. 20%\n');
        expect(texts).toContain('500.00\n100.00\n');
        expect(texts).toContain('600.00€');
      }
    });

    it('prints raw unrounded values through toFixed(2), exactly as the legacy did', () => {
      const texts = allTexts(
        build(
          lease({
            isPro: true,
            price: 650.285,
            charge: 100.005,
            additionalCharges: [
              { title: 'A', amount: 0.015 },
              { title: 'B', amount: 100.035 },
            ],
          }),
        ),
      );
      // The floating-point value is printed as is: (650.285).toFixed(2) is '650.28' (rounding to
      // cents first would give '650.29'), likewise '100.00' for 100.005 and '0.01' for 0.015.
      expect(texts).toContain('650.28\n130.06\n100.00\n');
      expect(texts).toContain('0.01\n');
      expect(texts).toContain('100.03\n');
      // The total sums the raw values in the legacy order: (price + VAT) + charge + additional charges.
      const total = 650.285 + 650.285 * 0.2 + 100.005 + 0.015 + 100.035;
      expect(texts).toContain(`${total.toFixed(2)}€`);
      // Nor is the total rounded before printing: 100.005 prints '100.00€' (cents rounding gives '100.01').
      expect(allTexts(build(lease({ price: 100.005 })))).toContain('100.00€');
      // Nor is the VAT: 100.475 * 0.2 = 20.095 prints '20.09' (cents rounding gives '20.10').
      expect(allTexts(build(lease({ isPro: true, price: 100.475 })))).toContain('100.47\n20.09\n');
    });

    it('prints "le lot n° N" when the lease has a lot and the lease name otherwise', () => {
      expect(allTexts(build(lease({ name: 'Studio', lot: 5 })))).toContain(
        '\n\nFACTURE DU LOYER pour le lot n° 5',
      );
      for (const lot of [0, null]) {
        expect(allTexts(build(lease({ name: 'Studio', lot })))).toContain(
          '\n\nFACTURE DU LOYER pour Studio',
        );
      }
    });

    it('period lines: first and last day of the billed month (leap year included)', () => {
      expect(allTexts(build(HABITATION_NO_CHARGE, { callDate: new Date(2026, 11, 25) }))).toContain(
        'Période du 01/01/2027 au 31/01/2027',
      );
      expect(allTexts(build(HABITATION_NO_CHARGE, { callDate: new Date(2028, 0, 25) }))).toContain(
        'Période du 01/02/2028 au 29/02/2028',
      );
      expect(allTexts(build(HABITATION_NO_CHARGE, { callDate: new Date(2027, 0, 25) }))).toContain(
        'Période du 01/02/2027 au 28/02/2027',
      );
      expect(allTexts(build(HABITATION_NO_CHARGE, { callDate: new Date(2026, 10, 25) }))).toContain(
        'Date \n01/12/2026',
      );
    });

    it('call date line and PDF title use the call date and `now` respectively', () => {
      const def = build(HABITATION_NO_CHARGE, {
        callDate: new Date(2027, 1, 3),
        now: new Date(2026, 10, 26, 23, 59, 59),
      });
      expect(allTexts(def)).toContain('LA CIOTAT \n Le 03/02/2027');
      expect(def.info?.title).toBe('26_11_2026_Agi Martin_Studio');
      expect(def.info?.subject).toBe('Appel de Loyer');
      expect(def.info?.keywords).toBe('LOYER Studio');
    });
  });

  describe('postal codes (the one deliberate difference with the legacy)', () => {
    const bourg = lease({ postalCode: 1000, city: 'Bourg-en-Bresse', name: 'Studio' });

    it('prints 1000 as 01000 in the tenant address and in the "local sis" line', () => {
      const legacyJson = JSON.stringify(legacy(bourg));
      expect(legacyJson.split('1000 BOURG-EN-BRESSE').length - 1).toBe(2);
      expect(legacyJson).not.toContain('01000');

      const built = JSON.stringify(build(bourg));
      expect(built.split('01000 BOURG-EN-BRESSE').length - 1).toBe(2);
      // Nothing else differs from the legacy.
      expect(built).toBe(legacyJson.replaceAll('1000 BOURG-EN-BRESSE', '01000 BOURG-EN-BRESSE'));
    });

    it.each([
      [999, '00999'],
      [1000, '01000'],
      [9999, '09999'],
      [10000, '10000'],
      [13600, '13600'],
      [75001, '75001'],
    ])('postal code %i is printed %s', (postalCode, printed) => {
      const texts = allTexts(build(lease({ postalCode, city: 'Ville' })));
      expect(texts).toContain(`AGI MARTIN\n12 RUE DES LILAS\n${printed} VILLE`);
      expect(texts).toContain(`Appartement, 12 rue des Lilas, ${printed} VILLE`);
    });

    it('does not pad the landlord address, which is free text of the profile', () => {
      const def = build(HABITATION_NO_CHARGE, {
        profile: { ...CUSTOM_PROFILE, addressLines: ['1 RUE A', '1000 BOURG'] },
      });
      expect(allTexts(def)).toContain(`SCI TEST\n${INDENT_18}1 RUE A\n${INDENT_18}1000 BOURG`);
    });
  });

  describe('leases that real data produces', () => {
    it('renders a lease with no renewalDate, lot, charge nor additional charge', () => {
      const def = build(INCOMPLETE);
      const texts = allTexts(def);
      expect(texts).toContain('\n\nFACTURE DU LOYER pour Cave');
      expect(texts).toContain('Loyer HT\n');
      expect(texts).toContain('120.00\n');
      expect(texts).toContain('120.00€');
    });

    it('prints names with accents and apostrophes as typed, upper-casing the address block', () => {
      const def = build(ACCENTED, { holder: holder("Élodie d'Aubigné-Œil") });
      const texts = allTexts(def);
      expect(texts).toContain(
        "ÉLODIE D'AUBIGNÉ-ŒIL\n7 RUE DE L'HÔTEL-DE-VILLE\nRÉSIDENCE L'ÉDEN, ESCALIER B\n42000 SAINT-ÉTIENNE",
      );
      expect(texts).toContain(
        "Appartement n° 2, 7 rue de l'Hôtel-de-Ville, Résidence l'Éden, escalier B, 42000 SAINT-ÉTIENNE",
      );
    });
  });
});
