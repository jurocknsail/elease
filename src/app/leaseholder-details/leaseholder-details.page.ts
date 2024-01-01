import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { LeaseholderService } from '../leaseholder.service';
import { FormArray, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Lease } from '../lease';


@Component({
  selector: 'app-leaseholder-details',
  templateUrl: './leaseholder-details.page.html',
  styleUrls: ['./leaseholder-details.page.scss'],
})
export class LeaseholderDetailsPage implements OnInit {
  
  leaseholder: any | undefined;
  leaseholderForm!: FormGroup;
  leaseForm!: FormGroup;

  constructor(
    private route: ActivatedRoute,
    private leaseholderService: LeaseholderService,
    private formBuilder: FormBuilder,
  ) {}

  
  onSubmit(): void {
    
  }
  
  ngOnInit() {
    // First get the leaseholder id from the current route.
    const routeParams = this.route.snapshot.paramMap;
    const leaseholderIdFromRoute = Number(routeParams.get('leaseholderId'));

    // Find the leaseholder that correspond with the id provided in route.
    this.leaseholder = this.leaseholderService.getLeaseholder(leaseholderIdFromRoute);

    // Manage leaseholder form
    this.leaseholderForm = this.formBuilder.group({
        name: [this.leaseholder.name,[Validators.required]],
        description: [this.leaseholder.description,[Validators.required]],
        phone: [this.leaseholder.phone,[Validators.required]],
        email: [this.leaseholder.email,[Validators.required, Validators.email]],
    });

    // Manage leases forms
    this.leaseForm = this.formBuilder.group({
      leases: this.formBuilder.array([])
    });

    this.leaseholder.leases.forEach((lease: Lease) => {
      this.addLease(lease);
    });

  }

  get leases (): FormArray {
    return this.leaseForm.controls["leases"] as FormArray;
  }

  addLease(lease: Lease): void {

    const leaseForm = this.formBuilder.group({
      lastUpdate: [lease.lastUpdate,[Validators.required]],
      renewalDate: [lease.renewalDate,[Validators.required]],
      indexing: [lease.indexing,[Validators.required]],
      price: [lease.price,[Validators.required]],
    });
    this.leases.push(leaseForm);

  }

}
