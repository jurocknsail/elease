import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Storage } from '@ionic/storage-angular';
import { Leaseholder } from './leaseholder';
import { Lease } from './lease';
import { tap } from 'rxjs/operators';
import { Observable, firstValueFrom } from 'rxjs';
import {ParseService} from "./parse-service.service";

@Injectable({
  providedIn: 'root'
})
export class StorageService {

  private _storage: Storage | null = null;
  private leaseholders: Leaseholder[] = [];
  private dataLoaded!: Observable<any>;

  constructor(
    private storage: Storage,
    private http: HttpClient,
    private parseService: ParseService
  ) { }

  // Load lease holders from local storage
  public async loadLeaseholders() {
    this.leaseholders = await this.get("data");
  }

  private loadData() {
    return this.http.get<Leaseholder[]>('/assets/data.json')
      .pipe(
        tap(data => {
          this.leaseholders = data;
        })
      );
  }

  async getData() {

/*
    if (this._storage == null) {
      const storage = await this.storage.create();
      this._storage = storage;
    }
*/
    //await this.loadLeaseholders();
    //this.leaseholders = this.getLeaseholders();


    this.leaseholders = await this.parseService.getLeaseholders();
    this.set("data", this.leaseholders);

    /*if (this.leaseholders == undefined) {
      this.dataLoaded = this.loadData();
      await firstValueFrom(this.dataLoaded);
      this.set("data", this.leaseholders);
    }*/

  }

  // Set Wrapper
  public set(key: string, value: any) {
    return this._storage?.set(key, value);
  }

  // Get wrapper
  public get(key: string): Promise<any> | undefined {
    return this._storage?.get(key);
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
    //this.set("data", this.leaseholders);
  }
  public deleteLeaseFromHolder(holderId: string, leaseId: number) {
    let holderLeases = this.getLeaseholder(holderId)?.leases;
    let leaseIndex = holderLeases?.findIndex(lease => lease.id === leaseId);
    if( leaseIndex != undefined) {

      console.log(leaseIndex)
      let _l = holderLeases?.[leaseIndex] ;
      if(_l != undefined && _l.objectId != undefined) {
        console.log(_l.objectId)
        this.parseService.deleteLease(_l.objectId)
      }

      holderLeases?.splice(leaseIndex, 1)
      //this.set("data", this.leaseholders);

    }
  }

  public addLeaseToHolder(holderId: string, addedLease: Lease): void {
    this.getLeaseholder(holderId)?.leases.push(addedLease);
    this.set("data", this.leaseholders);
  }

  public addLeaseHolder(leaseholder: Leaseholder) {
    this.getLeaseholders().push(leaseholder);
    this.parseService.createLeaseholder(leaseholder);
    this.set("data", this.leaseholders);
  }

  public updateLeaseHolder(leaseholder: Leaseholder) {

    /*
    let lh = this.getLeaseholder(leaseholder.objectId);
    if(lh != null) {
      lh.description = leaseholder.description;
      lh.email = leaseholder.email;
      lh.id = leaseholder.id;
      lh.name = leaseholder.name;
      lh.phone = leaseholder.phone;
      lh.leases = leaseholder.leases;
    }

    this.set("data", this.leaseholders);

     */
    this.parseService.updateLeaseholder(leaseholder);
  }

}
