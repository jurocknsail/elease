import { Injectable, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Leaseholder } from './leaseholder';


@Injectable({
  providedIn: 'root'
})
export class LeaseholderService {

  leasholders: Leaseholder [] = [];
  
  constructor(private http: HttpClient) {}

  private getJSON() {
      return this.http.get<Leaseholder[]>("./assets/data.json");
  }

  public loadLeaseholders () {
    this.getJSON().subscribe(data => {
      this.leasholders = data;
    });
  }

  public getLeaseholders (): Leaseholder [] {
    return this.leasholders;
  }

  public getLeaseholder(id: number): Leaseholder | undefined {
    return this.getLeaseholders().find((leaseholder) => leaseholder.id === id);
  }
  
}
