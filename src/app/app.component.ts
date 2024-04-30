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
  ) {}

  async ngOnInit() {
    await this.parseService.getData();


/*
    let lease1 = new LeaseClass(1,"Lease 1", 1, 41, "Chemin du chemin", "", 13000, "Marseille", "Some lease", 1, 1, 1, 1234, 123, true);
    let lease2 = new LeaseClass(2, "Lease 2", 2, 41, "Chemin du chemin", "", 13000, "Marseille", "Some lease", 1, 1, 1, 4321, 321, true);
    const leases: Lease[] = [lease1, lease2];
    let leaseholder = new LeaseHolderClass(1, "A leaseholder", "Some Holder", "leaseholder@gmail.com", "0611223344", leases);
    await this.parseService.createLeaseholder(leaseholder);

    console.log(await this.parseService.getLeaseholders());
*/


  }
}
