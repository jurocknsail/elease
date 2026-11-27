import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import { DEFAULT_LANDLORD_PROFILE, LandlordProfile } from '../models/landlord-profile';
import { Lease } from '../models/lease';
import { Leaseholder } from '../models/leaseholder';
import { buildRentCallDefinition } from './rent-call-definition';

/*
 * Golden master: the text of the rent-call PDF is fixed by the business rules (CLAUDE.md), so the
 * literal below must never change by accident. Dates are built with local-time constructors so the
 * suite passes in every time zone.
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

/** Professional lease with a charges advance and one additional charge. */
const PRO_WITH_CHARGES = lease({
  isPro: true,
  name: 'Local commercial',
  lot: 3,
  optionalAddressInfo: 'Bâtiment B',
  price: 1234,
  charge: 123,
  additionalCharges: [{ title: 'Taxe foncière', amount: 50 }],
});

/** Habitation lease: `charge` null and `lot` 0. */
const HABITATION_NO_CHARGE = lease({ name: 'Studio', lot: 0, price: 300, charge: null });

/** No renewal date, no lot, no charge, no additional charge (5 of 9 real leases). */
const INCOMPLETE = lease({
  name: 'Cave',
  lot: null,
  renewalDate: null,
  charge: null,
  additionalCharges: [],
  price: 120,
});

/** Several additional charges with float-ugly amounts. */
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

/** Accents and apostrophes in the names, another city, another 5-digit postal code. */
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
  describe('golden master, default landlord profile', () => {
    it('matches the golden master below for a simple lease', () => {
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

  it('DEFAULT_LANDLORD_PROFILE holds the landlord values of the PDF', () => {
    const legacyDef = JSON.parse(JSON.stringify(build(HABITATION_NO_CHARGE))) as {
      info: { author: string };
      content: Array<{ text: unknown }>;
    };
    const header = (legacyDef.content[0].text as string).split('\n').map((line) => line.trim());
    expect(header).toEqual([
      DEFAULT_LANDLORD_PROFILE.name,
      ...DEFAULT_LANDLORD_PROFILE.addressLines,
    ]);
    const issue = legacyDef.content[2].text as string[];
    expect(issue[0].split(' \n Le ')[0]).toBe(DEFAULT_LANDLORD_PROFILE.issueCity);
    expect(issue[2].trim()).toBe(`Établie par la ${DEFAULT_LANDLORD_PROFILE.name}`);
    expect(legacyDef.info.author).toBe(DEFAULT_LANDLORD_PROFILE.name);
    const conditions = legacyDef.content[5].text as Array<{ text: string }>;
    expect(conditions[1].text.split('\n').map((line) => line.trim())[3]).toBe(
      DEFAULT_LANDLORD_PROFILE.legalNotice,
    );
    expect(DEFAULT_LANDLORD_PROFILE.emailSignature).toBe('Pierre MARGERIT');
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
      // ...while the default profile of the same lease does contain them (the scan is meaningful).
      const defaultJson = JSON.stringify(build(FAR_AWAY));
      expect(defaultJson).toContain('SCI LA CHARINE');
      expect(defaultJson).toContain('LA CIOTAT');
      expect(defaultJson).toContain('507 834 117');
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

    it('prints a multi-line legal notice with the legal-text indentation, trimming CRLF and stray spaces', () => {
      const def = build(FAR_AWAY, {
        profile: { ...CUSTOM_PROFILE, legalNotice: 'Ligne 1.  \r\n   Ligne 2.\n' },
      });
      const conditions = allTexts(def).find((t) => t.includes('En application de la loi'));
      expect(conditions).toBe(
        `\nEn application de la loi n° 92.1482 Du 31/12/92, le règlement anticipé ne donnera pas lieu à escompte.\n` +
          `${INDENT_20}En cas de réglement après échéance, il sera fait applications des dispositions légales après mise en demeure.\n` +
          `${INDENT_20}Ligne 1.\n${INDENT_20}Ligne 2.\n${INDENT_20}\n`,
      );
      expect(JSON.stringify(def)).not.toContain('\\r');
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

  describe('contents that stay exactly as printed before', () => {
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

    it('prints no VAT line for a habitation lease, and no "Avance sur charges" line when the charge is null or 0', () => {
      const texts = allTexts(build(lease({ price: 300, charge: 40 })));
      expect(texts).toContain('Loyer HT\nAvance sur charges\n');
      expect(texts).toContain('340.00€');
      expect(texts.join('')).not.toContain('T.V.A.');
      for (const charge of [null, 0]) {
        const noCharge = allTexts(build(lease({ isPro: true, price: 500, charge })));
        expect(noCharge).toContain('Loyer HT\nT.V.A. 20%\n');
        expect(noCharge).toContain('600.00€');
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

  describe('postal codes are printed with 5 digits', () => {
    const bourg = lease({ postalCode: 1000, city: 'Bourg-en-Bresse', name: 'Studio' });

    it('prints 1000 as 01000 in the tenant address and in the "local sis" line', () => {
      const built = JSON.stringify(build(bourg));
      expect(built.split('01000 BOURG-EN-BRESSE').length - 1).toBe(2);
      expect(built).not.toMatch(/(?<!0)1000 BOURG/);
    });

    it('pads short postal codes to 5 digits, leaves full ones and the free-text landlord address alone', () => {
      for (const [postalCode, printed] of [
        [999, '00999'],
        [10000, '10000'],
        [75001, '75001'],
      ] as const) {
        const texts = allTexts(build(lease({ postalCode, city: 'Ville' })));
        expect(texts).toContain(`AGI MARTIN\n12 RUE DES LILAS\n${printed} VILLE`);
        expect(texts).toContain(`Appartement, 12 rue des Lilas, ${printed} VILLE`);
      }
      const def = build(HABITATION_NO_CHARGE, {
        profile: { ...CUSTOM_PROFILE, addressLines: ['1 RUE A', '1000 BOURG'] },
      });
      expect(allTexts(def)).toContain(`SCI TEST\n${INDENT_18}1 RUE A\n${INDENT_18}1000 BOURG`);
    });
  });
});
