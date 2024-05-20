import { Component } from '@angular/core';
import {ParseService} from "./parse-service.service";
import {LeaseHolderClass} from "./leaseholder";
import {Lease, LeaseClass} from "./lease";
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
