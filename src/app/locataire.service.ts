import { Injectable, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Locataire } from './locataire';


@Injectable({
  providedIn: 'root'
})
export class LocataireService {

  locataires: Locataire [] = [];
  
  constructor(private http: HttpClient) {}

  private getJSON() {
      return this.http.get<Locataire[]>("./assets/data.json");
  }

  public loadLocataires () {
    this.getJSON().subscribe(data => {
      this.locataires = data;
    });
  }

  public getLocataires (): Locataire [] {
    return this.locataires;
  }

  public getLocataire(id: number): Locataire | undefined {
    return this.getLocataires().find((locataire) => locataire.id === id);
  }
  
}
