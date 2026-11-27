import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import { computeTotalPrice, computeTVA } from '../billing/amounts';
import { billingPeriod, legacyPeriodMonth, periodLastDay } from '../billing/period';
import { formatDate, formatPostalCode } from '../format/fr';
import type { LandlordProfile } from '../models/landlord-profile';
import type { Lease } from '../models/lease';
import type { Leaseholder } from '../models/leaseholder';

/*
 * The text of the rent-call PDF keeps the wording, labels, arithmetic and whitespace fixed by the
 * business rules (the spec pins it with a golden master). Only the landlord data (header,
 * "Établie par la ...", issue city, PDF author, legal notice) comes from the landlord profile, and
 * postal codes are printed with 5 digits.
 *
 * The legacy PDF text carries the indentation of its source template literals (continuation lines
 * start with 18 spaces, or 20 in the conditions). It is part of the document, so it is kept.
 */
const INDENT = ' '.repeat(18);
const CONDITIONS_INDENT = ' '.repeat(20);

/** First two lines of the conditions, before the landlord's legal notice (legacy spelling kept). */
const PAYMENT_CONDITIONS = [
  'En application de la loi n° 92.1482 Du 31/12/92, le règlement anticipé ne donnera pas lieu à escompte.',
  'En cas de réglement après échéance, il sera fait applications des dispositions légales après mise en demeure.',
];

export interface RentCallDefinitionArgs {
  leaseholder: Leaseholder;
  lease: Lease;
  profile: LandlordProfile;
  /** The date printed on the rent call; the billed period is the month after it. */
  callDate: Date;
  /** The current time: only its date is used, in the title of the PDF. */
  now: Date;
}

/** Name and address lines of the landlord, one per line (blank lines skipped). */
function letterhead(name: string, addressLines: readonly string[]): string {
  const lines = [name, ...addressLines.map((line) => line.trim()).filter((line) => line !== '')];
  return lines.join('\n' + INDENT);
}

/** The conditions paragraph: payment conditions, then the legal notice if the profile has one. */
function conditions(legalNotice: string): string {
  const notice = legalNotice.trim();
  const noticeLines = notice === '' ? [] : notice.split(/\r?\n/).map((line) => line.trim());
  const lines = [...PAYMENT_CONDITIONS, ...noticeLines];
  return '\n' + lines.join('\n' + CONDITIONS_INDENT) + '\n' + CONDITIONS_INDENT + '\n';
}

export function buildRentCallDefinition(args: RentCallDefinitionArgs): TDocumentDefinitions {
  const { leaseholder, lease, profile, callDate, now } = args;

  const period = billingPeriod(callDate);
  const periodMonth = legacyPeriodMonth(period);
  const landlordName = profile.name.trim();
  const postalCode = formatPostalCode(lease.postalCode);
  const optionalInfo = lease.optionalAddressInfo ?? '';
  // "Avance sur charges" is billed (and listed) only for a charge that is neither null nor 0.
  const charge = lease.charge != null && lease.charge !== 0 ? lease.charge : null;
  const additionalCharges = lease.additionalCharges || [];

  return {
    info: {
      title:
        formatDate(now.getTime()).replaceAll('/', '_') + '_' + leaseholder.name + '_' + lease.name,
      author: landlordName,
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
        text: letterhead(landlordName, profile.addressLines),
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
          (optionalInfo !== '' ? optionalInfo.toUpperCase() + '\n' : '') +
          postalCode +
          ' ' +
          lease.city.toUpperCase(),
      },
      {
        alignment: 'left',
        text: [
          profile.issueCity.trim() + ' \n Le ' + formatDate(callDate.getTime()),
          {
            text:
              '\n\nFACTURE DU LOYER pour ' +
              (lease.lot != null && lease.lot !== 0 ? 'le lot n° ' + lease.lot : lease.name),
            bold: true,
          },
          '\n\n' + INDENT + 'Établie par la ' + landlordName,
        ],
      },
      {
        alignment: 'justify',
        text: [
          {
            text:
              'Période du 01/' + periodMonth + ' au ' + periodLastDay(period) + '/' + periodMonth,
            bold: true,
          },
          {
            text:
              '\n\n' +
              INDENT +
              'Madame, Monsieur,\n' +
              INDENT +
              'Nous vous prions de recevoir ci-dessous le détail de votre facture concernant le local sis :\n' +
              INDENT,
          },
          {
            text:
              lease.name +
              ', ' +
              lease.streetNumber +
              ' ' +
              lease.streetName +
              ', ' +
              (optionalInfo !== '' ? optionalInfo + ', ' : '') +
              postalCode +
              ' ' +
              lease.city.toUpperCase(),
            italics: true,
          },
          '\n' + INDENT + '\n\n' + INDENT,
        ],
      },
      {
        columns: [
          { text: 'Date \n01/' + periodMonth, bold: true },
          {
            text: [
              { text: 'Libellé\n', bold: true },
              'Loyer HT\n' +
                (lease.isPro ? 'T.V.A. 20%\n' : '') +
                (charge !== null ? 'Avance sur charges\n' : ''),
              ...additionalCharges.map((c) => ({ text: c.title + '\n', style: ['black'] })),
              { text: 'Total TTC', bold: true },
            ],
          },
          {
            alignment: 'right',
            text: [
              { text: 'Montant\n', bold: true },
              // Raw, unrounded values printed through toFixed(2), as the legacy did.
              lease.price.toFixed(2) +
                '\n' +
                (lease.isPro ? computeTVA(lease).toFixed(2) + '\n' : '') +
                (charge !== null ? charge.toFixed(2) + '\n' : ''),
              ...additionalCharges.map((c) => ({
                text: c.amount.toFixed(2) + '\n',
                style: ['black'],
              })),
              { text: computeTotalPrice(lease).toFixed(2) + '€', bold: true },
            ],
          },
        ],
      },
      {
        alignment: 'justify',
        text: [
          { text: '\n\nConditions de règlement :', italics: true },
          { text: conditions(profile.legalNotice), italics: true },
        ],
      },
      {
        alignment: 'justify',
        text: '\n' + INDENT,
      },
    ],
  };
}
