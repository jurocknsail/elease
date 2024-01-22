import { Component, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormArray, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Lease, LeaseClass } from '../lease';
import { IonAccordionGroup, IonButton, IonModal } from '@ionic/angular';
import { StorageService } from '../storage-service.service';
import { Location } from '@angular/common';

@Component({
  selector: 'app-leaseholder-details',
  templateUrl: './leaseholder-details.page.html',
  styleUrls: ['./leaseholder-details.page.scss'],
})
export class LeaseholderDetailsPage implements OnInit {

  @ViewChild('accordionGroup', { static: true })
  accordionGroup!: IonAccordionGroup;

  @ViewChild('editButton', { static: true })
  editButton!: IonButton;

  @ViewChild('deleteButton', { static: true })
  deleteButton!: IonButton;

  @ViewChild(IonModal) modal!: IonModal;

  leaseholder: any | undefined;
  leaseholderForm!: FormGroup;
  leaseForm!: FormGroup;
  newLeaseForm!: FormGroup;
  isEditing = false;

  constructor(
    private route: ActivatedRoute,
    private formBuilder: FormBuilder,
    private storageService: StorageService,
    private location: Location
  ) { }

  ngOnInit() {

    // First get the leaseholder id from the current route.
    const routeParams = this.route.snapshot.paramMap;
    const leaseholderIdFromRoute = Number(routeParams.get('leaseholderId'));

    // Find the leaseholder that correspond with the id provided in route.
    this.leaseholder = this.storageService.getLeaseholder(leaseholderIdFromRoute);

    // Manage leaseholder form
    this.leaseholderForm = this.formBuilder.group({
      name: [this.leaseholder.name, [Validators.required]],
      description: [this.leaseholder.description, [Validators.required]],
      phone: [this.leaseholder.phone, [Validators.required]],
      email: [this.leaseholder.email, [Validators.required, Validators.email]],
    });

    // Manage leases forms
    this.leaseForm = this.formBuilder.group({
      leases: this.formBuilder.array([])
    });
    this.leaseholder.leases.forEach((lease: Lease) => {
      this.addLease(lease);
    });

    // Manage new lease form
    this.newLeaseForm = this.formBuilder.group({
      name: ["", [Validators.required]],
      lot: ["", [Validators.required]],
      address: ["", [Validators.required]],
      renewalDate: ["", [Validators.required]],
      indexing: ["", [Validators.required]],
      price: ["", [Validators.required]],
    });

    this.toogleEdit(false);

  }

  // Getter for leases forms
  get leases(): FormArray {
    return this.leaseForm.controls["leases"] as FormArray;
  }

  onEdit() {
    this.isEditing = !this.isEditing!;
    this.toogleEdit(this.isEditing);
    this.editButton.disabled = true;
  }

  async onDelete() {
    this.storageService.deleteLeaseholder(this.leaseholder.id);
    await this.modal.dismiss(null, 'confirm');
    this.location.back();
  }

  async onDeleteLease(holderId: number, leaseId: number) {
    //console.log((this.leases.at(leaseId-1) as FormGroup).controls)
    this.storageService.deleteLeaseFromHolder(holderId, leaseId);
 }

  // On edit lease/leaseholder form save
  onSave(): void {
    this.isEditing = !this.isEditing!;
    this.toogleEdit(this.isEditing);
    this.editButton.disabled = false;

    this.leaseholder.name = this.leaseholderForm.controls["name"].value,
      this.leaseholder.description = this.leaseholderForm.controls["description"].value,
      this.leaseholder.email = this.leaseholderForm.controls["email"].value,
      this.leaseholder.phone = this.leaseholderForm.controls["phone"].value,

      this.leases.controls.forEach((control, index) => {
        this.leaseholder.leases[index].lot = control.get("lot")?.value;
        this.leaseholder.leases[index].address = control.get("address")?.value;
        this.leaseholder.leases[index].renewalDate = control.get("renewalDate")?.value;
        this.leaseholder.leases[index].indexing = control.get("indexing")?.value;
        this.leaseholder.leases[index].price = control.get("price")?.value;
      });

    this.storageService.updateLeaseHolder(this.leaseholder);
  }

  // On ADD form Submit actions
  onAdd(): void {

    // Add lease to model
    let addedLease = new LeaseClass(
      this.leases.length + 1,
      this.newLeaseForm.controls["name"].value,
      this.newLeaseForm.controls["lot"].value,
      this.newLeaseForm.controls["address"].value,
      "",
      0,
      this.newLeaseForm.controls["renewalDate"].value,
      this.newLeaseForm.controls["indexing"].value,
      this.newLeaseForm.controls["price"].value,
    );
    this.storageService.addLeaseToHolder(this.leaseholder.id, addedLease);

    // Add corresponding form
    this.addLease(addedLease);

    // Expand it
    let toogleAccordionId: string = `${this.leases.length - 1}`;
    this.accordionGroup.value = toogleAccordionId;

    // Clear the form
    this.newLeaseForm.reset();
  }

  private toogleEdit(edit: boolean) {
    if (edit) {
      Object.keys(this.leaseholderForm.controls).forEach(key => {
        this.leaseholderForm.get(key)?.enable();
      });
      Object.keys(this.leases.controls).forEach(key => {
        Object.keys((this.leases.get(key) as FormGroup).controls).forEach(controlKey => {
          if (controlKey != "lastSendDate") {
            (this.leases.get(key) as FormGroup).get(controlKey)?.enable();
          }
        });
      });
    } else {
      Object.keys(this.leaseholderForm.controls).forEach(key => {
        this.leaseholderForm.get(key)?.disable();
      });
      Object.keys(this.leases.controls).forEach(key => {
        this.leases.get(key)?.disable();
      });
    }
  }

  // Helper to add lease forms
  private addLease(lease: Lease): void {
    const leaseForm = this.formBuilder.group({
      address: [lease.address],
      lot: [lease.lot],
      lastSendDate: [lease.lastSendDate],
      renewalDate: [lease.renewalDate, [Validators.required]],
      indexing: [lease.indexing, [Validators.required]],
      price: [lease.price, [Validators.required]],
    });
    this.leases.push(leaseForm);
    this.toogleEdit(false);
  }

}
