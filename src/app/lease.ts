export interface Lease {
  isSelected: boolean;
  id: number;
  name: string;
  lot: number;
  address: string;
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
  public address: string;
  public description: string;
  public lastSendDate: number;
  public renewalDate: number;
  public indexing: number;
  public price: number;
  public charge: number;
  public isSelected = true;

  constructor(
    id: number,
    name: string,
    lot: number,
    address: string,
    description: string,
    lastSendDate: number,
    renewalDate: number,
    indexing: number,
    price: number,
    charge: number,
    //isSelected: boolean,
  ) {

    this.id = id;
    this.name = name;
    this.lot = lot;
    this.address = address;
    this.description = description;
    this.lastSendDate = lastSendDate;
    this.renewalDate = renewalDate;
    this.indexing = indexing;
    this.price = price;
    this.isSelected = true;
    this.charge = charge;
  }

  toString(): string {
    return this.id + ' ' 
    + this.name + ' ' 
    + this.lot + ' ' 
    + this.address + ' ' 
    + this.description + ' ' 
    + this.lastSendDate + ' ' + 
    this.renewalDate + ' ' + 
    this.indexing + ' ' +
    this.price + ' ' +
    this.isSelected + ' ' +
    this.charge + ' '
  }
}
