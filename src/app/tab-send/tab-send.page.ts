import { Component, OnInit } from '@angular/core';
import { LocataireService } from '../locataire.service';
import { Locataire } from '../locataire';

@Component({
  selector: 'app-tab-send',
  templateUrl: 'tab-send.page.html',
  styleUrls: ['tab-send.page.scss']
})
export class TabSendPage implements OnInit {
  locataires: Locataire[] | undefined;

  constructor(
    private locataireService: LocataireService,
  ) {}

  ngOnInit() {

    // Find the product that correspond with the id provided in route.
    this.locataires = this.locataireService.getLocataires();
   
  }
}
