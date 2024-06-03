import { Component } from '@angular/core';
import {ParseService} from "./services/parse-service.service";

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
})
export class AppComponent {

  constructor(
    private parseService: ParseService
  ) {
  }
}
