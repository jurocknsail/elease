import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Storage } from '@ionic/storage-angular';
import { Leaseholder } from './leaseholder';
import { Lease } from './lease';
import { tap } from 'rxjs/operators';
import { Observable, firstValueFrom } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class StorageService {
  
  private _storage: Storage | null = null;
  private leaseholders: Leaseholder[] = [];
  private dataLoaded!: Observable<any>;

  constructor(
    private storage: Storage, 
    private http: HttpClient
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

    if (this._storage == null) {
      const storage = await this.storage.create();
      this._storage = storage;
    }

    await this.loadLeaseholders();
    this.leaseholders = this.getLeaseholders();

    if (this.leaseholders == undefined) {
      this.dataLoaded = this.loadData();
      await firstValueFrom(this.dataLoaded);
      this.set("data", this.leaseholders);
    }

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

  public getLeaseholder(id: number): Leaseholder | undefined {
    return this.getLeaseholders().find((leaseholder) => leaseholder.id === id);
  }

  public addLeaseToHolder(holderId: number, addedLease: Lease): void {
    this.getLeaseholder(holderId)?.leases.push(addedLease);
    this.set("data", this.leaseholders);
  }

  public addLeaseHolder(leaseholder: Leaseholder) {
    this.getLeaseholders().push(leaseholder);
    this.set("data", this.leaseholders);
  }

}
