import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { LocataireService } from '../locataire.service';
import { Locataire } from '../locataire';

@Component({
  selector: 'app-locataire-details',
  templateUrl: './locataire-details.page.html',
  styleUrls: ['./locataire-details.page.scss'],
})
export class LocataireDetailsPage implements OnInit {
  
  locataire: any | undefined;

  constructor(
    private route: ActivatedRoute,
    private locataireService: LocataireService
  ) {}

  ngOnInit() {
    // First get the product id from the current route.
    const routeParams = this.route.snapshot.paramMap;
    const locataireIdFromRoute = Number(routeParams.get('locataireId'));

    // Find the product that correspond with the id provided in route.
    console.log(locataireIdFromRoute);
    this.locataire = this.locataireService.getLocataire(locataireIdFromRoute);
  }

}
