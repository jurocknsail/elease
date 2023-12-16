import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';


@Injectable({
  providedIn: 'root'
})
export class LocataireService {

  constructor(private http: HttpClient) {
  }

  public getJSON(): Observable<any> {
      return this.http.get("./assets/data.json");
  }
}
