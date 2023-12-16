import { Bail } from './bail'

export interface Locataire {
    id: number;
    name: string;
    description: string;
    bails: Bail [];
  }
  