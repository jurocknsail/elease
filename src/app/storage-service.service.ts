import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Storage } from '@ionic/storage-angular';
import { Leaseholder } from './leaseholder';
import { Lease } from './lease';

@Injectable({
  providedIn: 'root'
})
export class StorageService {
  private _storage: Storage | null = null;
  private leasholders: Leaseholder [] = [];

  constructor(private storage: Storage, private http: HttpClient) {
    this.init();
  }

  //Init
  async init() {
    // If using, define drivers here: await this.storage.defineDriver(/*...*/);
    const storage = await this.storage.create();
    this._storage = storage;
  }

  // --------------------------- From ASSETS Data -----------------------------------

  private getJSON() {
    return this.http.get<Leaseholder[]>("./assets/data.json");
  }

  public loadLeaseholdersFromAssets () {
    this.getJSON().subscribe(data => {
      this.leasholders = data;
      this.set("data", this.leasholders);
      console.log("No local data, assets data loaded and stored : " + JSON.stringify(this.leasholders));
    });
  }

  // --------------------------- From Local Storage -----------------------------------

  // Set Wrapper
  public set(key: string, value: any) {
    return this._storage?.set(key, value);
  }

  // Get wrapper
  public get(key: string): Promise<any> | undefined {
    return this._storage?.get(key);
  } 

  // Load lease holders from local storage
  public async loadLeaseholders () {

    this.leasholders = await this.get("data");

    if(this.leasholders == undefined) {
      this.loadLeaseholdersFromAssets();
    } else {
      console.log("Local data loaded : " + JSON.stringify(this.leasholders));
    }

  }

  public getLeaseholders (): Leaseholder [] {
    return this.leasholders;
  }

  public getLeaseholder(id: number): Leaseholder | undefined {
    return this.getLeaseholders().find((leaseholder) => leaseholder.id === id);
  }

  public addLeaseToHolder (holderId:number, addedLease:Lease): void{
    this.getLeaseholder(holderId)?.leases.push(addedLease);
    this.set("data", this.leasholders);
  }

}
