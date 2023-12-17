import { Component, OnInit } from '@angular/core';
import { LocataireService } from '../locataire.service';
import { Locataire } from '../locataire';

@Component({
  selector: 'app-tab-list',
  templateUrl: 'tab-list.page.html',
  styleUrls: ['tab-list.page.scss']
})
export class TabListPage implements OnInit {
  
  locataires: Locataire [] = [];
  constructor(
      private locatairesService : LocataireService 
  ) { }

 ngOnInit(){
     this.locataires = this.locatairesService.getLocataires();
 }
}
