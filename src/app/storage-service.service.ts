import { Injectable } from '@angular/core';
import { Leaseholder } from './leaseholder';
import { Lease } from './lease';
import {ParseService} from "./parse-service.service";

@Injectable({
  providedIn: 'root'
})
export class StorageService {

  private leaseholders: Leaseholder[] = [];

  constructor(
    private parseService: ParseService
  ) { }

  async getData() {
    this.leaseholders = await this.parseService.getLeaseholders();
  }

  public getLeaseholders(): Leaseholder[] {
    return this.leaseholders;
  }

  public setLeaseholders(leaseholders: Leaseholder[]) {
    this.leaseholders = leaseholders;
  }

  public getLeaseholder(id: string | null | undefined ): Leaseholder | undefined {
    return this.getLeaseholders().find((leaseholder) => leaseholder.objectId === id);
  }

  public deleteLeaseholder(id: string) {
    this.parseService.deleteLeaseHolder(id);
    this.getLeaseholders().splice(this.getLeaseholders().findIndex(item => item.objectId === id), 1)
  }
  public deleteLeaseFromHolder(holderId: string, leaseId: string) {
    let holderLeases = this.getLeaseholder(holderId)?.leases;
    let leaseIndex = holderLeases?.findIndex(lease => lease.objectId === leaseId);
    if( leaseIndex != undefined) {

      console.log(leaseIndex)
      let _l = holderLeases?.[leaseIndex] ;
      if(_l != undefined && _l.objectId != undefined) {
        console.log(_l.objectId)
        this.parseService.deleteLease(_l.objectId)
      }

      holderLeases?.splice(leaseIndex, 1)
    }
  }

  public addLeaseToHolder(holderId: string, addedLease: Lease): void {
    this.parseService.addLeaseToHolder(addedLease, holderId);
    this.getLeaseholder(holderId)?.leases.push(addedLease);
    //this.set("data", this.leaseholders);
  }

  public async addLeaseHolder(leaseholder: Leaseholder) {
    let createdLeaseholder : Leaseholder = await this.parseService.createLeaseholder(leaseholder);
    this.getLeaseholders().push(createdLeaseholder);
  }

  public updateLeaseHolder(leaseholder: Leaseholder) {
    this.parseService.updateLeaseholder(leaseholder);
  }

}
