import { Lease } from './lease'

export interface Leaseholder {
    id: number;
    name: string;
    email: string;
    phone: string;
    description: string;
    leases: Lease [];
  }
  