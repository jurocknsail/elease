import { Component } from '@angular/core';
import {ParseService} from "./services/parse-service.service";
import {LeaseHolderClass} from "./model/leaseholder";
import {Lease, LeaseClass} from "./model/lease";
import Parse from "parse";

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
