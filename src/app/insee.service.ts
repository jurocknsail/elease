import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import {environment} from "../environments/environment";
import { map } from 'rxjs/operators';
import { xml2js } from 'xml-js';

@Injectable({
  providedIn: 'root'
})
export class InseeService {
  private apiUrl = 'https://api.insee.fr/series/BDM/V1/data';
  private apiKey = environment.inseeApiKey;

  constructor(private http: HttpClient) { }


  // Méthode pour récupérer les dernières valeurs de l'IRL
  getIRL(): Observable<any> {
    const url = `${this.apiUrl}/IRL`;
    const headers = this.getHeaders();
    return this.http.get(url, { headers, responseType: 'text' }).pipe(
      map(response => this.parseXml(response))
    );
  }

  // Méthode pour récupérer les dernières valeurs de l'ILC
  getILC(): Observable<any> {
    const url = `${this.apiUrl}/SERIES_BDM/001532540`;
    const headers = this.getHeaders();
    return this.http.get(url, { headers, responseType: 'text' }).pipe(
      map(response => this.parseXml(response))
    );
  }

  private getHeaders(): HttpHeaders {
    return new HttpHeaders().set('Authorization', `Bearer ${this.apiKey}`);
  }

  private parseXml(xml: string): any {
    return xml2js(xml, { compact: true });
  }
}
