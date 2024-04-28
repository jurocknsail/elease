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

  async updateLeaseholder(leaseholder: Leaseholder): Promise<any> {
    const LeaseholderObject = Parse.Object.extend('Leaseholder');
    const query = new Parse.Query(LeaseholderObject);

    try {
      if (leaseholder.objectId != null) {
        const leaseholderObject = await query.get(leaseholder.objectId);
        leaseholderObject.set('name', leaseholder.name);
        leaseholderObject.set('description', leaseholder.description);
        leaseholderObject.set('email', leaseholder.email);
        leaseholderObject.set('phone', leaseholder.phone);

        const LeaseObject = Parse.Object.extend('Lease');
        const leaseQuery = new Parse.Query(LeaseObject);
        const leases: Parse.Object[] = [];
        for (const lease of leaseholder.leases) {
          if (lease.objectId != null) {
            const leaseObject = await leaseQuery.get(lease.objectId);
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
          }
        }
        leaseholderObject.set('leases', leases);

        const result = await leaseholderObject.save();
        return result.toJSON();
      }

    } catch (error) {
      console.error('Error updating leaseholder: ', error);
      throw error;
    }
  }

  async deleteLease(leaseId: string): Promise<void> {
    const LeaseObject = Parse.Object.extend('Lease');
    const query = new Parse.Query(LeaseObject);

    try {
      const leaseObject = await query.get(leaseId);
      await leaseObject.destroy();
    } catch (error) {
      console.error('Error deleting lease: ', error);
      throw error;
    }
  }

  async deleteLeaseHolder(leaseHolderObjectId: string): Promise<void> {
    const LeaseholderObject = Parse.Object.extend('Leaseholder');
    const query = new Parse.Query(LeaseholderObject);

    try {
      const leaseholderObject = await query.get(leaseHolderObjectId);
      let leases : Parse.Object[] = leaseholderObject.get("leases");
      if (leases && leases.length > 0) {
        await Promise.all(leases.map(async (lease: Parse.Object) => {
          try {
            await lease.destroy();
          } catch (error) {
            console.error('Error deleting associated leases: ', error);
          }
        }));
      }
      await leaseholderObject.destroy();
    } catch (error) {
      console.error('Error deleting leaseholder: ', error);
      throw error;
    }
  }

}
