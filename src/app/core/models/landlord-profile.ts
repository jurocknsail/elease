export interface LandlordProfile {
  objectId?: string;
  /** Name or company name printed in the PDF header and legal text. */
  name: string;
  addressLines: string[];
  /** City printed before the call date ("LA CIOTAT, le ..."). */
  issueCity: string;
  legalNotice: string;
  /** Signature closing the rent-call e-mail. */
  emailSignature: string;
}

/**
 * Values that used to be hard-coded in the legacy app (PDF header, issue city, legal text, e-mail
 * signature). A user without a profile gets one pre-filled with these, so PDFs and e-mails stay
 * identical. Always copy before handing it out: the array must not be shared.
 */
export const DEFAULT_LANDLORD_PROFILE: LandlordProfile = {
  name: 'SCI LA CHARINE',
  addressLines: ['41 CHEMIN DES BAGNOLS', '13600 LA CIOTAT'],
  issueCity: 'LA CIOTAT',
  legalNotice:
    'SCI LA CHARINE au capital de 2000 euros, inscrite au RCS de MARSEILLE sous le n° 507 834 117.',
  emailSignature: 'Pierre MARGERIT',
};
