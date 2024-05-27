// parse.service.ts
import { Injectable } from '@angular/core';
import Parse from 'parse';
import { Lease } from "./lease";
import { LeaseHolderClass, Leaseholder } from "./leaseholder";
import { Observable, from } from 'rxjs';
import { environment } from "../environments/environment";
import { LeasePdfInfo } from './leasepdfinfo';

@Injectable({
  providedIn: 'root'
})
export class ParseService {

  private leaseholders: Leaseholder[] = [];
  public emailAndBase64PDF = new Map<string, LeasePdfInfo[]>();


  constructor() {
    Parse.initialize(environment.parseAppId, environment.parseJsKey);
    Parse.serverURL = environment.parseServerUrl;
  }

  async fetchLeaseholders() {
    const LeaseholderObject = Parse.Object.extend('Leaseholder');
    const query = new Parse.Query(LeaseholderObject);
    query.include('leases');
    await query.find().then((leaseHolders) => {
      // @ts-ignore
      this.leaseholders = leaseHolders.map(lh => lh.toJSON() as Leaseholder);

      this.leaseholders.forEach(l => {
        console.log("Fetched leaseholder : " + l.objectId);
      })
    });
  }

  public getLeaseholders(): Leaseholder[] {
    return this.leaseholders;
  }

  async createLeaseholder(leaseholder: Leaseholder): Promise<void> {
    const leaseholderObject = new Parse.Object('Leaseholder');
    leaseholderObject.set('name', leaseholder.name);
    leaseholderObject.set('description', leaseholder.description);
    leaseholderObject.set('email', leaseholder.email);
    leaseholderObject.set('phone', leaseholder.phone);
    const leases: Parse.Object[] = [];
    leaseholderObject.set('leases', leases);

    try {
      // @ts-ignore
      const lh = (await leaseholderObject.save()).toJSON() as Leaseholder;
      this.getLeaseholders().push(lh);

      console.log("Leaseholder created : " + lh.objectId);

    } catch (error) {
      console.error('Error creating leaseholder: ', error);
      throw error;
    }
  }

  async updateLeaseholder(leaseholder: Leaseholder): Promise<void> {
    const LeaseholderObject = Parse.Object.extend('Leaseholder');
    const query = new Parse.Query(LeaseholderObject);

    try {
      if (leaseholder.objectId != null) {

        console.log("Updating leaseholder with id : " + leaseholder.objectId)

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

            console.log("Updating lease with id : " + lease.objectId)

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

        await leaseholderObject.save();

        console.log("Updated leaseholder with id : " + leaseholder.objectId)
      }

    } catch (error) {
      console.error('Error updating leaseholder: ', error);
      throw error;
    }
  }

  async addLeaseToHolder(leaseholderId: string, lease: Lease): Promise<string> {

    try {

      console.log("Adding lease " + lease.name + " to leaseholder with id : " + leaseholderId);

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

      let leaseObj = await leaseObject.save();
      // @ts-ignore
      lease = leaseObj.toJSON() as Lease;

      const LeaseholderObject = Parse.Object.extend('Leaseholder');
      const query = new Parse.Query(LeaseholderObject);
      const leaseholderObject = await query.get(leaseholderId);

      let leases: Parse.Object[] = leaseholderObject.get('leases');
      leases.push(leaseObj);
      leaseholderObject.set('leases', leases);
      await leaseholderObject.save();

      console.log("Added lease " + lease.name + "(" + lease.objectId + ") to leaseholder with id : " + leaseholderId);

    } catch (error) {
      console.error('Error updating leaseholder: ', error);
      throw error;
    }
    if (lease.objectId != undefined) {
      return lease.objectId;
    } else {
      return "";
    }
  }

  async deleteLease(leaseId: string): Promise<void> {
    console.log("Deleting Lease " + leaseId)
    const LeaseObject = Parse.Object.extend('Lease');
    const query = new Parse.Query(LeaseObject);

    try {
      const leaseObject = await query.get(leaseId);
      await leaseObject.destroy();
    } catch (error) {
      console.error('Error deleting lease: ', error);
      throw error;
    }
    console.log("Deleted Lease " + leaseId)
  }

  async deleteLeaseholder(leaseHolderObjectId: string): Promise<void> {

    console.log("Deleting leaseholder with id : " + leaseHolderObjectId);

    const LeaseholderObject = Parse.Object.extend('Leaseholder');
    const query = new Parse.Query(LeaseholderObject);

    try {
      const leaseholderObject = await query.get(leaseHolderObjectId);
      let leases: Parse.Object[] = leaseholderObject.get("leases");
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
      this.getLeaseholders().splice(this.getLeaseholders().findIndex(item => item.objectId === leaseHolderObjectId), 1)
    } catch (error) {
      console.error('Error deleting leaseholder: ', error);
      throw error;
    }
  }

  public getLeaseholder(id: string | null | undefined): Leaseholder | undefined {
    return this.getLeaseholders().find((leaseholder) => leaseholder.objectId === id);
  }

  public async deleteLeaseFromHolder(holderId: string, leaseId: string) {
    console.log("Deleting Lease " + leaseId + " from holder " + holderId)
    let holderLeases = this.getLeaseholder(holderId)?.leases;
    let leaseIndex = holderLeases?.findIndex(lease => lease.objectId === leaseId);
    if (leaseIndex != undefined) {
      let _l = holderLeases?.[leaseIndex];
      if (_l != undefined && _l.objectId != undefined) {

        // Delete lease pointer in leaseholder
        const LeaseholderObject = Parse.Object.extend('Leaseholder');
        const query = new Parse.Query(LeaseholderObject);
        console.log("Removing lease pointer from leaseholder with id : " + holderId)
        const leaseholderObject = await query.get(holderId);
        let leasesPointers = leaseholderObject.get("leases")
        let updatedLeasesPointers = leasesPointers.filter((lease: Parse.Object) => lease.id !== leaseId);
        leaseholderObject.set("leases", updatedLeasesPointers);
        await leaseholderObject.save();
        // The delete lease object
        this.deleteLease(_l.objectId)
      }
      this.getLeaseholder(holderId)?.leases.splice(leaseIndex, 1)
    }
    console.log("Deleted Lease " + leaseId + " from holder " + holderId)
  }

  sendEmail(recipientEmail: string, pdfDataList: LeasePdfInfo[]) : Observable<any>{

    let attachments: any[] = [];
    let attachment: { [key: string]: any };
    
      pdfDataList.forEach((pdfData) => {
        attachment = {
          ContentType: 'application/pdf',
          Filename: pdfData.pdfName,
          Base64Content: pdfData.pdfBase64,
        };
        attachments.push(attachment);
      });

      console.log("Sending email(s) for leaseholder : " + recipientEmail + " with data : " + JSON.stringify(attachments, ['ContentType', 'Filename'], 2));

      const CloudCode = Parse.Cloud;
      return from(CloudCode.run('sendEmail', {
        senderEmail: environment.senderEmail,
        recipientEmail: recipientEmail,
        subject: "Facture de loyer pour le mois de " + pdfDataList[0].pdfDate,
        text:
          `Bonjour,
  
  Merci de trouver ci-joint le(s) appel(s) de loyer(s) pour la prochaine période.
  Bonne reception, 
  
  Pierre MARGERIT`,
        attachments: attachments,
        sandbox: environment.sandbox
      }))

  }

  public addLeaseholderPDF(recipientEmail: string, pdfData: LeasePdfInfo) {
    if (!this.emailAndBase64PDF.has(recipientEmail)) {
      this.emailAndBase64PDF.set(recipientEmail, []);
    }
    this.emailAndBase64PDF.get(recipientEmail)!.push(pdfData);
  }

  public getLeaseholdersPDFs() {
    return this.emailAndBase64PDF;
  }

}
