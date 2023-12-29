import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { LocataireService } from '../locataire.service';
import { FormArray, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Bail } from '../bail';


@Component({
  selector: 'app-locataire-details',
  templateUrl: './locataire-details.page.html',
  styleUrls: ['./locataire-details.page.scss'],
})
export class LocataireDetailsPage implements OnInit {
  
  locataire: any | undefined;

  bailsForm!: FormGroup;

  constructor(
    private route: ActivatedRoute,
    private locataireService: LocataireService,
    private formBuilder: FormBuilder,
  ) {}

  onSubmit(): void {
    
  }
  
  ngOnInit() {
    // First get the product id from the current route.
    const routeParams = this.route.snapshot.paramMap;
    const locataireIdFromRoute = Number(routeParams.get('locataireId'));

    // Find the product that correspond with the id provided in route.
    this.locataire = this.locataireService.getLocataire(locataireIdFromRoute);

    this.bailsForm = this.formBuilder.group({
      bails: this.formBuilder.array([])
    });

    this.locataire.bails.forEach((bail: Bail) => {
      this.addBail(bail);
    });

  }

  get bails (): FormArray {
    return this.bailsForm.controls["bails"] as FormArray;
  }

  addBail(bail: Bail): void {

    const bailForm = this.formBuilder.group({
      lastUpdate: [bail.lastUpdate,[Validators.required]],
      renewalDate: [bail.renewalDate,[Validators.required]],
      indexing: [bail.indexing,[Validators.required]],
      price: [bail.price,[Validators.required]],
      email: [bail.email, [Validators.required, Validators.email]],
    });
    this.bails.push(bailForm);

  }

}
