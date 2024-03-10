export interface Lease {
  isSelected: boolean;
  isPro : boolean;
  id: number;
  name: string;
  lot: number;
  streetNumber: number;
  streetName: string;
  optionalAddressInfo: string;
  postalCode: number;
  city: string;
  description: string;
  lastSendDate: number;
  renewalDate: number;
  indexing: number;
  price: number;
  charge: number;
}

export class LeaseClass implements Lease {

  public id: number;
  public name: string;
  public lot: number;
  public streetNumber: number;
  public streetName: string;
  public optionalAddressInfo: string;
  public postalCode: number;
  public city: string;
  public description: string;
  public lastSendDate: number;
  public renewalDate: number;
  public indexing: number;
  public price: number;
  public charge: number;
  public isSelected : boolean = true;
  public isPro: boolean = true;

  constructor(
    id: number,
    name: string,
    lot: number,
    streetNumber: number,
    streetName: string,
    optionalAddressInfo: string,
    postalCode: number,
    city: string,
    description: string,
    lastSendDate: number,
    renewalDate: number,
    indexing: number,
    price: number,
    charge: number,
    //isSelected: boolean,
    isPro: boolean,
  ) {

    this.id = id;
    this.name = name;
    this.lot = lot;
    this.streetNumber = streetNumber;
    this.streetName = streetName;
    this.optionalAddressInfo = optionalAddressInfo;
    this.postalCode = postalCode;
    this.city = city;
    this.description = description;
    this.lastSendDate = lastSendDate;
    this.renewalDate = renewalDate;
    this.indexing = indexing;
    this.price = price;
    this.isSelected = true;
    this.charge = charge;
    this.isPro = isPro;
  }

  toString(): string {
    return this.id + ' '
      + this.name + ' '
      + this.lot + ' '
      + this.streetNumber + ' '
      + this.streetName + ' '
      + this.optionalAddressInfo + ' '
      + this.postalCode + ' '
      + this.city + ' '
      + this.description + ' '
      + this.lastSendDate + ' ' +
      this.renewalDate + ' ' +
      this.indexing + ' ' +
      this.price + ' ' +
      this.isSelected + ' ' +
      this.isPro + ' ' +
      this.charge + ' '
  }
}
