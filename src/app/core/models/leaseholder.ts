import { Lease } from './lease';

export interface Leaseholder {
  objectId?: string;
  name: string;
  email: string;
  phone: string;
  leases: Lease[];
}
