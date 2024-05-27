
export interface LeasePdfInfo {
  pdfName: string,
  pdfDate: string,
  pdfBase64: string,
}

export class LeasePdfInfoClass implements LeasePdfInfo {

  public pdfName: string;
  public pdfDate: string;
  public pdfBase64: string;

  constructor(
    pdfName: string,
    pdfDate: string,
    pdfBase64: string,
  ) {

    this.pdfName = pdfName;
    this.pdfDate = pdfDate;
    this.pdfBase64 = pdfBase64;
  }
}
