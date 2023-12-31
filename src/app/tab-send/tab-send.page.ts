import { Component, OnInit } from '@angular/core';
import { LeaseholderService } from '../leaseholder.service';
import { Leaseholder } from '../leaseholder';

@Component({
  selector: 'app-tab-send',
  templateUrl: 'tab-send.page.html',
  styleUrls: ['tab-send.page.scss']
})
export class TabSendPage implements OnInit {
  leaseholders: Leaseholder[] | undefined;

  constructor(
    private leaseholderService: LeaseholderService,
  ) {}

  ngOnInit() {

    // Find the product that correspond with the id provided in route.
    this.leaseholders = this.leaseholderService.getLeaseholders();
   
  }
}
