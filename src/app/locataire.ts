import { Bail } from './bail'

export interface Locataire {
    id: number;
    name: string;
    description: string;
    bails: Bail [];
  }
  
  export const locataires = [
    {
      id: 1,
      name: 'Aggimo',
      description: 'Agence immobilière.',
      bails: [
        {
            id: 1,
            name: "Local",
            description: "Local Agence."
        },
        {
            id: 2,
            name: "Garage",
            description: "Garage Agence."
        }
      ]
    },
    {
      id: 2,
      name: 'Perrine',
      description: 'Salle de Pilates'
    },
  ];