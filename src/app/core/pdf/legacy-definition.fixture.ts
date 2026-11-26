/**
 * FROZEN COPY of the legacy rent-call PDF construction. TEST-ONLY: nothing in the application may
 * import this file (same rule as `parse/testing/fake-parse-client.ts`), so it never reaches the bundle.
 * DO NOT EDIT it, not even to tidy it: it is the ground truth the new definition is compared with.
 *
 * Source: `main:src/app/tab-send/tab-send.page.ts` (branch `main`, tag `legacy-ionic`):
 *   - lines 201-306  the `docDefinition` construction, copied verbatim (inside `buildDocDefinition`);
 *   - lines 88-90    `daysInNextMonth`;
 *   - lines 92-104   `computePeriod`;
 *   - lines 127-141  `computeTVA` and `computeTotalPrice`;
 *   - lines 369-371  `generatePdfName` (the attachment / file name).
 * `this.now` and `this.defaultSendDate` of the legacy page are the constructor arguments `now` and
 * `callDate` (the legacy computed the default call date from a string, which was wrong west of UTC;
 * the new code takes the date as an input, so the comparison is made for explicit dates). The only
 * other change is formatting (Prettier): the contents of the template literals, which carry the
 * source indentation into the PDF text, are untouched.
 *
 * Deliberate difference of the new definition: postal codes go through `formatPostalCode`
 * (5 digits). It is identical for every code of 10000 and above (13600, ...) and differs only for
 * 1000-9999, which the legacy printed without the leading zero ("1000" instead of "01000").
 */
import { formatDate } from '@angular/common';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import type { Lease } from '../models/lease';
import type { Leaseholder } from '../models/leaseholder';

/** What the legacy mail body (`main:src/app/services/parse-service.service.ts`, lines 352-357) signs with. */
export const LEGACY_EMAIL_SIGNATURE = 'Pierre MARGERIT';

class LegacyTabSendPage {
  periodMonth!: string;

  constructor(
    readonly now: Date,
    readonly defaultSendDate: Date,
  ) {}

  daysInNextMonth(date: Date) {
    return new Date(date.getFullYear(), date.getMonth() + 2, 0).getDate();
  }

  computePeriod(): string {
    let month;
    let year;
    if (this.defaultSendDate.getMonth() < 11) {
      month = this.defaultSendDate.getMonth() + 2;
      year = this.defaultSendDate.getFullYear();
    } else {
      month = 1;
      year = this.defaultSendDate.getFullYear() + 1;
    }
    this.periodMonth =
      month.toLocaleString('en-US', { minimumIntegerDigits: 2, useGrouping: false }) + '/' + year;
    return this.periodMonth;
  }

  computeTVA(lease: Lease): number {
    return lease.price * 0.2;
  }
  computeTotalPrice(lease: Lease): number {
    let noChargesPrice = lease.isPro ? lease.price + this.computeTVA(lease) : lease.price;
    let totalPrice =
      lease.charge != null && lease.charge != 0 ? noChargesPrice + lease.charge : noChargesPrice;

    if (lease.additionalCharges) {
      lease.additionalCharges.forEach((charge) => {
        totalPrice += charge.amount;
      });
    }

    return totalPrice;
  }

  generatePdfName(leaseholder: Leaseholder, lease: Lease, periodMonth: string): string {
    return (
      leaseholder.name.trim().replace(' ', '_').toLowerCase() +
      '-' +
      lease.name.trim().replace(' ', '_').toLowerCase() +
      '-' +
      periodMonth.trim().replace('/', '_') +
      '.pdf'
    );
  }

  buildDocDefinition(leaseholder: Leaseholder, lease: Lease): TDocumentDefinitions {
    const docDefinition: TDocumentDefinitions = {
      info: {
        title:
          formatDate(this.now, 'dd_MM_yyyy', 'en-GB') + '_' + leaseholder.name + '_' + lease.name,
        author: 'SCI LA CHARINE',
        subject: 'Appel de Loyer',
        keywords: 'LOYER ' + lease.name,
      },
      styles: {
        red: {
          bold: true,
          color: '#ff5500',
        },
      },
      content: [
        {
          alignment: 'left',
          text: `SCI LA CHARINE
                  41 CHEMIN DES BAGNOLS
                  13600 LA CIOTAT`,
        },
        {
          alignment: 'right',
          text:
            leaseholder.name.toUpperCase() +
            '\n' +
            lease.streetNumber +
            ' ' +
            lease.streetName.toUpperCase() +
            '\n' +
            (lease.optionalAddressInfo != null && lease.optionalAddressInfo != ''
              ? lease.optionalAddressInfo.toUpperCase() + '\n'
              : '') +
            lease.postalCode +
            ' ' +
            lease.city.toUpperCase(),
        },
        {
          alignment: 'left',
          text: [
            'LA CIOTAT \n Le ' + formatDate(this.defaultSendDate, 'dd/MM/yyyy', 'en-GB'),
            {
              text:
                '\n\nFACTURE DU LOYER pour ' +
                (lease.lot != null && lease.lot != 0 ? 'le lot n° ' + lease.lot : lease.name),
              bold: true,
            },
            `

                  Établie par la SCI LA CHARINE`,
          ],
        },
        {
          alignment: 'justify',
          text: [
            {
              text:
                'Période du 01/' +
                this.computePeriod() +
                ' au ' +
                this.daysInNextMonth(this.defaultSendDate) +
                '/' +
                this.computePeriod(),
              bold: true,
            },
            {
              text: `

                  Madame, Monsieur,
                  Nous vous prions de recevoir ci-dessous le détail de votre facture concernant le local sis :
                  `,
            },
            {
              text:
                lease.name +
                ', ' +
                lease.streetNumber +
                ' ' +
                lease.streetName +
                ', ' +
                (lease.optionalAddressInfo != null && lease.optionalAddressInfo != ''
                  ? lease.optionalAddressInfo + ', '
                  : '') +
                lease.postalCode +
                ' ' +
                lease.city.toUpperCase(),
              italics: true,
            },
            `
                  \n
                  `,
          ],
        },
        {
          columns: [
            { text: 'Date \n01/' + this.computePeriod(), bold: true },
            {
              text: [
                { text: 'Libellé\n', bold: true },
                'Loyer HT\n' +
                  (lease.isPro ? 'T.V.A. 20%\n' : '') +
                  (lease.charge != null && lease.charge != 0 ? 'Avance sur charges\n' : ''),
                ...(lease.additionalCharges || []).map((c) => ({
                  text: c.title + '\n',
                  style: ['black'],
                })),
                { text: 'Total TTC', bold: true },
              ],
            },
            {
              alignment: 'right',
              text: [
                { text: 'Montant\n', bold: true },
                lease.price.toFixed(2) +
                  '\n' +
                  (lease.isPro ? this.computeTVA(lease).toFixed(2) + '\n' : '') +
                  (lease.charge != null && lease.charge != 0 ? lease.charge.toFixed(2) + '\n' : ''),
                ...(lease.additionalCharges || []).map((c) => ({
                  text: c.amount.toFixed(2) + '\n',
                  style: ['black'],
                })),
                { text: this.computeTotalPrice(lease).toFixed(2) + '€', bold: true },
              ],
            },
          ],
        },
        {
          alignment: 'justify',
          text: [
            { text: '\n\nConditions de règlement :', italics: true },
            {
              text: `\nEn application de la loi n° 92.1482 Du 31/12/92, le règlement anticipé ne donnera pas lieu à escompte.
                    En cas de réglement après échéance, il sera fait applications des dispositions légales après mise en demeure.
                    SCI LA CHARINE au capital de 2000 euros, inscrite au RCS de MARSEILLE sous le n° 507 834 117.
                    \n`,
              italics: true,
            },
          ],
        },
        {
          alignment: 'justify',
          text: `
                  `,
        },
      ],
    };
    return docDefinition;
  }
}

/** The legacy PDF definition for `leaseholder` / `lease`, `now` and `callDate` being the legacy `now` and `defaultSendDate`. */
export function legacyDefinition(
  leaseholder: Leaseholder,
  lease: Lease,
  now: Date,
  callDate: Date,
): TDocumentDefinitions {
  return new LegacyTabSendPage(now, callDate).buildDocDefinition(leaseholder, lease);
}

/** The legacy file name of the PDF (also the e-mail attachment name). */
export function legacyPdfName(
  leaseholder: Leaseholder,
  lease: Lease,
  now: Date,
  callDate: Date,
): string {
  const page = new LegacyTabSendPage(now, callDate);
  // The legacy computed `periodMonth` while building the definition.
  page.buildDocDefinition(leaseholder, lease);
  return page.generatePdfName(leaseholder, lease, page.periodMonth);
}
