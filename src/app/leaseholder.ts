import { Lease } from './lease'

export interface Leaseholder {
  objectId?: string;
  name: string;
  description: string;
  email: string;
  phone: string;
  leases: Lease[];
}

export class LeaseHolderClass implements Leaseholder {

  public name: string;
  public description: string;
  public email: string;
  public phone: string;
  public leases: Lease[];

  constructor(
    name: string,
    description: string,
    email: string,
    phone: string,
    leases: Lease[],

  ) {

    this.name = name;
    this.description = description;
    this.email = email;
    this.phone = phone;
    this.leases = leases;

  }
}
