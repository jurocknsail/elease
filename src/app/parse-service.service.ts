// parse.service.ts
import { Injectable } from '@angular/core';
import Parse from 'parse';
import {Lease} from "./lease";
import {Leaseholder} from "./leaseholder";

@Injectable({
  providedIn: 'root'
})
export class ParseService {
  constructor() {
    Parse.initialize('C7MCVCYTpBqpybLw6FBsI9Nf8soq5mYF36yLgVOS', 'Z7iF24sIAoPWz2hViLXQCSdmilMhDWNs1A67ajXY');
    Parse.serverURL = 'https://parseapi.back4app.com';
  }

  async createLeaseholder(leaseholder: Leaseholder): Promise<any> {
    const leaseholderObject = new Parse.Object('Leaseholder');
    leaseholderObject.set('name', leaseholder.name);
    leaseholderObject.set('description', leaseholder.description);
    leaseholderObject.set('email', leaseholder.email);
    leaseholderObject.set('phone', leaseholder.phone);

    const leases: Parse.Object[] = [];
    leaseholder.leases.forEach((lease: Lease) => {
      const leaseObject = new Parse.Object('Lease');
      leaseObject.set('isSelected', lease.isSelected);
      leaseObject.set('isPro', lease.isPro);
      leaseObject.set('name', lease.name);
      leaseObject.set('lot', lease.lot);
      leaseObject.set('streetNumber', lease.streetNumber);
      leaseObject.set('streetName', lease.streetName);
      leaseObject.set('optionalAddressInfo', lease.optionalAddressInfo);
      leaseObject.set('postalCode', lease.postalCode);
      leaseObject.set('city', lease.city);
      leaseObject.set('description', lease.description);
      leaseObject.set('lastSendDate', lease.lastSendDate);
      leaseObject.set('renewalDate', lease.renewalDate);
      leaseObject.set('price', lease.price);
      leaseObject.set('charge', lease.charge);
      leaseObject.set('indexing', lease.indexing);
      leases?.push(leaseObject);
    });
    leaseholderObject.set('leases', leases);

    try {
      const result = await leaseholderObject.save();
      return result.toJSON();
    } catch (error) {
      console.error('Error creating leaseholder: ', error);
      throw error;
    }
  }

  async getLeaseholders(): Promise<any[]> {
    const LeaseholderObject = Parse.Object.extend('Leaseholder');
    const query = new Parse.Query(LeaseholderObject);
    // Include the 'leases' pointer column to fetch associated leases
    query.include('leases');

    try {
      const leaseHolders = await query.find();
      return leaseHolders.map(result => {
        return result.toJSON()
      });
    } catch (error) {
      console.error('Error fetching leaseholders: ', error);
      throw error;
    }
  }


}
