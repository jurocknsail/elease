import { Lease } from './lease'

export interface Leaseholder {
  objectId?: string;
  name: string;
  email: string;
  phone: string;
  leases: Lease[];
}

export class LeaseHolderClass implements Leaseholder {

  public name: string;
  public email: string;
  public phone: string;
  public leases: Lease[];

  constructor(
    name: string,
    email: string,
    phone: string,
    leases: Lease[],

  ) {

    this.name = name;
    this.email = email;
    this.phone = phone;
    this.leases = leases;

  }
}
