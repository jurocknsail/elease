import {Injectable} from '@angular/core';
import {HttpClient, HttpHeaders} from '@angular/common/http';
import {Observable} from 'rxjs';
import {environment} from "../../environments/environment";
import {map} from 'rxjs/operators';
import {XMLParser} from 'fast-xml-parser';

@Injectable({
  providedIn: 'root'
})
export class InseeService {
  private apiUrl = 'https://api.insee.fr/series/BDM/V1/data';
  private apiKey = environment.inseeApiKey;

  constructor(private http: HttpClient) { }


  // Méthode pour récupérer les dernières valeurs de l'IRL
  getIRL(): Observable<InseeDataRootObject> {
    const url = `${this.apiUrl}/SERIES_BDM/001515333`;
    const headers = this.getHeaders();
    return this.http.get(url, { headers, responseType: 'text' }).pipe(
      map(response => this.parseXml(response))
    );
  }

  // Méthode pour récupérer les dernières valeurs de l'ILC
  getILC(): Observable<InseeDataRootObject> {
    const url = `${this.apiUrl}/SERIES_BDM/001617112`;
    const headers = this.getHeaders();
    return this.http.get(url, { headers, responseType: 'text' }).pipe(
      map(response => this.parseXml(response))
    );
  }

  private getHeaders(): HttpHeaders {
    return new HttpHeaders().set('Authorization', `Bearer ${this.apiKey}`);
  }

  private parseXml(xml: string): any {

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: ''
    });
    let jsonObject = parser.parse(xml);
    //console.log(JSON.stringify(jsonObject));
    return jsonObject;

  }
}
