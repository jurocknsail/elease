
export interface LeasePdfInfo {
  pdfName: string,
  pdfDate: string,
  pdfBase64: string,
  leaseObjectId: string | undefined
}

export class LeasePdfInfoClass implements LeasePdfInfo {

  public pdfName: string;
  public pdfDate: string;
  public pdfBase64: string;
  public leaseObjectId: string | undefined;

  constructor(
    pdfName: string,
    pdfDate: string,
    pdfBase64: string,
    leaseObjectId: string | undefined
  ) {

    this.pdfName = pdfName;
    this.pdfDate = pdfDate;
    this.pdfBase64 = pdfBase64;
    this.leaseObjectId = leaseObjectId;
  }
}
