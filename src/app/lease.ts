export interface Lease {
  id: number;
  name: string;
  description: string;
  lastSendDate: number;
  renewalDate: number;
  indexing: number;
  price: number;
}

export class LeaseClass implements Lease {

  public id: number;
  public name: string;
  public description: string;
  public lastSendDate: number;
  public renewalDate: number;
  public indexing: number;
  public price: number;

  constructor(
    id: number,
    name: string,
    description: string,
    lastSendDate: number,
    renewalDate: number,
    indexing: number,
    price: number,

  ) {

    this.id = id;
    this.name = name;
    this.description = description;
    this.lastSendDate = lastSendDate;
    this.renewalDate = renewalDate;
    this.indexing = indexing;
    this.price = price;

  }

  toString(): string {
    return this.id + ' ' 
    + this.name + ' ' 
    + this.description + ' ' 
    + this.lastSendDate + ' ' + 
    this.renewalDate + ' ' + 
    this.indexing + ' ' +
    this.price + ' ' 
  }
}
