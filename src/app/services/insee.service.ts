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

  public lastIRLValue : number = 0;
  public lastILCValue : number = 0;

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

  getIRLData(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.getIRL().subscribe({
        next: data => {
          // Traiter les données de l'IRL ici
          let lastIRL = data["message:StructureSpecificData"]["message:DataSet"].Series.Obs[0].OBS_VALUE;
          let serieName = data["message:StructureSpecificData"]["message:DataSet"].Series.TITLE_FR;
          this.lastIRLValue = Number(lastIRL);
          console.log("Last INSEE IRL : " + this.lastIRLValue + " from INSEE Serie '" + serieName + "'");
          resolve(this.lastIRLValue);
        },
        error: error => {
          console.error('Erreur lors de la récupération des données de l\'IRL', error);
          reject(error);
        }
      });
    });
  }

  getILCData(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.getILC().subscribe({
        next: data => {
          // Traiter les données de l'ILC ici
          let lastILC = data["message:StructureSpecificData"]["message:DataSet"].Series.Obs[0].OBS_VALUE;
          let serieName = data["message:StructureSpecificData"]["message:DataSet"].Series.TITLE_FR;
          this.lastILCValue = Number(lastILC);
          console.log("Last INSEE ILC : " + this.lastILCValue + " from INSEE Serie '" + serieName + "'");
          resolve(this.lastILCValue);
        },
        error: error => {
          console.error('Erreur lors de la récupération des données de l\'ILC', error);
          reject(error);
        }
      });
    });
  }
}
