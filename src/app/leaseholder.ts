import { Lease } from './lease'

export interface Leaseholder {
  id: number;
  name: string;
  description: string;
  email: string;
  phone: string;
  leases: Lease[];
}

class LeaseHolderClass implements Leaseholder {

  public id: number;
  public name: string;
  public description: string;
  public email: string;
  public phone: string;
  public leases: Lease[];

  constructor(
    id: number,
    name: string,
    description: string,
    email: string,
    phone: string,
    leases: Lease[],

  ) {

    this.id = id;
    this.name = name;
    this.description = description;
    this.email = email;
    this.phone = phone;
    this.leases = leases;

  }
}