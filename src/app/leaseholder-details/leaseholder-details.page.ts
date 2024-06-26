import {Component, OnInit, ViewChild} from '@angular/core';
import {ActivatedRoute} from '@angular/router';
import {FormArray, FormBuilder, FormGroup, Validators} from '@angular/forms';
import {Lease, LeaseClass} from '../model/lease';
import {AlertController, IonAccordionGroup, IonButton, IonModal} from '@ionic/angular';
import {Location} from '@angular/common';
import {ParseService} from '../services/parse-service.service';
import {Leaseholder} from '../model/leaseholder';
import { InseeService } from '../services/insee.service';
import {phoneNumberValidator} from "../validators/phone-number.validator";

@Component({
  selector: 'app-leaseholder-details',
  templateUrl: './leaseholder-details.page.html',
  styleUrls: ['./leaseholder-details.page.scss'],
})
export class LeaseholderDetailsPage implements OnInit {

  @ViewChild('accordionGroup', {static: false})
  accordionGroup!: IonAccordionGroup;

  @ViewChild('editButton', {static: false})
  editButton!: IonButton;

  @ViewChild(IonModal) modal!: IonModal;

  leaseholder: Leaseholder | any | undefined;
  leaseholderForm!: FormGroup;
  leaseForm!: FormGroup;
  newLeaseForm!: FormGroup;
  isEditing = false;
  currentLeaserId!: string;
  currentLeaseFormIndexId!: number;
  currentLeaseName!: string;

  constructor(
    private route: ActivatedRoute,
    private formBuilder: FormBuilder,
    private parseService: ParseService,
    private inseeService: InseeService,
    private location: Location,
    private alertController: AlertController,
  ) {
  }

  async ngOnInit() {

    // First get the leaseholder id from the current route.
    const routeParams = this.route.snapshot.paramMap;
    const leaseholderIdFromRoute = routeParams.get('leaseholderId');

    // Find the leaseholder that correspond with the id provided in route.
    this.leaseholder = this.parseService.getLeaseholder(leaseholderIdFromRoute);

    if (!this.leaseholder) {
      await this.parseService.fetchLeaseholders();
      this.leaseholder = this.parseService.getLeaseholder(leaseholderIdFromRoute);
    }

    // Manage leaseholder form
    this.leaseholderForm = this.formBuilder.group({
      name: [this.leaseholder.name, [Validators.required]],
      phone: [this.leaseholder.phone, [Validators.required, phoneNumberValidator()]],
      email: [this.leaseholder.email, [Validators.required, Validators.email]],
    });

    // Manage leases forms
    this.leaseForm = this.formBuilder.group({
      leases: this.formBuilder.array([])
    });
    this.leaseholder.leases.forEach((lease: Lease) => {
      this.addLeaseForm(lease);
    });

    // Manage new lease form
    this.newLeaseForm = this.formBuilder.group({
      name: ["", [Validators.required]],
      lot: ["", [Validators.required]],
      streetNumber: ["", [Validators.required]],
      streetName: ["", [Validators.required]],
      optionalAddressInfo: ["", []],
      postalCode: ["", [Validators.required]],
      city: ["", [Validators.required]],
      price: ["", [Validators.required]],
      charge: ["", []],
      isPro: [false, []],
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
    await this.presentDeleteLeaseHolderAlert();
  }

  async presentDeleteLeaseHolderAlert() {
    const alert = await this.alertController.create({
      header: 'Confirmation de suppression',
      message: 'Voulez vous vraiment supprimer le locataire ' + this.leaseholder.name,
      buttons: this.alertDeleteLeaseHolderButtons,
    });
    await alert.present();
  }

  public alertDeleteLeaseHolderButtons = [
    {
      text: 'Annuler',
      role: 'cancel'
    },
    {
      text: 'OK',
      role: 'confirm',
      handler: () => {
        console.log('Alert confirmed');
        this.deleteLeaseHolder();
      },
    },
  ];

  async deleteLeaseHolder() {
    await this.parseService.deleteLeaseholder(this.leaseholder.objectId);
    this.location.back();
  }

  async onDeleteLease(leaseFormIndex: number) {
    let deletingLease: Leaseholder = this.leaseholder.leases[leaseFormIndex]
    if (deletingLease.objectId != null) {
      this.currentLeaserId = deletingLease.objectId;
      this.currentLeaseFormIndexId = leaseFormIndex;
      this.currentLeaseName = deletingLease.name;
      await this.presentDeleteLeaseAlert();
    }
  }

  async presentDeleteLeaseAlert() {
    const alert = await this.alertController.create({
      header: 'Confirmation de suppression',
      message: 'Voulez vous vraiment supprimer le bail ' + this.currentLeaseName,
      buttons: this.alertDeleteLeaseButtons,
    });
    await alert.present();
  }

  public alertDeleteLeaseButtons = [
    {
      text: 'Annuler',
      role: 'cancel'
    },
    {
      text: 'OK',
      role: 'confirm',
      handler: () => {
        console.log('Alert confirmed');
        this.deleteLease(this.currentLeaserId, this.currentLeaseFormIndexId);
      },
    },
  ];

  deleteLease(leaseId: string, leaseFormIndex: number) {
    console.log(leaseId + "/" + leaseFormIndex)
    this.leases.controls.splice(leaseFormIndex, 1);
    this.parseService.deleteLeaseFromHolder(this.leaseholder.objectId, leaseId);
  }

  // On edit lease/leaseholder form save
  onSave(): void {
    this.isEditing = !this.isEditing!;
    this.toogleEdit(this.isEditing);
    this.editButton.disabled = false;

    this.leaseholder.name = this.leaseholderForm.controls["name"].value;
    this.leaseholder.email = this.leaseholderForm.controls["email"].value;
    this.leaseholder.phone = this.leaseholderForm.controls["phone"].value;

      this.leases.controls.forEach((control, index) => {
        this.leaseholder.leases[index].name = control.get("name")?.value;
        this.leaseholder.leases[index].lot = control.get("lot")?.value;
        this.leaseholder.leases[index].streetNumber = control.get("streetNumber")?.value;
        this.leaseholder.leases[index].streetName = control.get("streetName")?.value;
        this.leaseholder.leases[index].optionalAddressInfo = control.get("optionalAddressInfo")?.value;
        this.leaseholder.leases[index].postalCode = control.get("postalCode")?.value;
        this.leaseholder.leases[index].city = control.get("city")?.value;
        this.leaseholder.leases[index].renewalDate = new Date(control.get("renewalDate")?.value).getTime();
        this.leaseholder.leases[index].indexing = control.get("indexing")?.value;
        this.leaseholder.leases[index].price = control.get("price")?.value;
        this.leaseholder.leases[index].charge = control.get("charge")?.value;
        this.leaseholder.leases[index].isPro = control.get("isPro")?.value;
      });

    this.parseService.updateLeaseholder(this.leaseholder);
  }

  // On ADD form Submit actions
  async onAdd() {

    const isPro : boolean = this.newLeaseForm.controls["isPro"].value;
    let indexing : number;
    if(isPro){
      if(this.inseeService.lastILATValue != 0 ) {
        indexing = this.inseeService.lastILATValue;
      } else {
        indexing = await this.inseeService.getILATData();
      }
      console.log("Lease is set as Pro, using ILAT Index : " + indexing);
    } else {
      if(this.inseeService.lastIRLValue != 0 ) {
        indexing = this.inseeService.lastIRLValue;
      } else {
        indexing = await this.inseeService.getIRLData();
      }
      console.log("Lease is NOT set as Pro, using IRL Index : " + indexing);
    }

    // Add lease to model
    let addedLease = new LeaseClass(
      this.newLeaseForm.controls["name"].value,
      this.newLeaseForm.controls["lot"].value,
      this.newLeaseForm.controls["streetNumber"].value,
      this.newLeaseForm.controls["streetName"].value,
      this.newLeaseForm.controls["optionalAddressInfo"].value,
      this.newLeaseForm.controls["postalCode"].value,
      this.newLeaseForm.controls["city"].value,
      0,
      new Date().getTime(),
      indexing,
      this.newLeaseForm.controls["price"].value,
      this.newLeaseForm.controls["charge"].value,
      this.newLeaseForm.controls["isPro"].value,
    );

    // Push to DB
    // Add lease to local holder
    (addedLease as Lease).objectId = await this.parseService.addLeaseToHolder(this.leaseholder.objectId, addedLease);
    this.leaseholder.leases.push(addedLease);

    // Add corresponding form
    this.addLeaseForm(addedLease);

    // Expand it
    this.accordionGroup.value = `${this.leases.length - 1}`;

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
          if (controlKey != "isPro" && controlKey != "indexing") {
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
  private addLeaseForm(lease: Lease): void {

    const leaseAnniversaryDate = new  Date(lease.renewalDate).toISOString().split('T')[0]; // Get current date in YYYY-MM-DD format

    const leaseForm = this.formBuilder.group({
      name: [lease.name, [Validators.required]],
      streetNumber: [lease.streetNumber, [Validators.required]],
      streetName: [lease.streetName, [Validators.required]],
      optionalAddressInfo: [lease.optionalAddressInfo, []],
      postalCode: [lease.postalCode, [Validators.required]],
      city: [lease.city, [Validators.required]],
      lot: [lease.lot, [Validators.required]],
      renewalDate: [leaseAnniversaryDate, [Validators.required]],
      indexing: [lease.indexing, [Validators.required]],
      price: [lease.price, [Validators.required]],
      charge: [lease.charge, []],
      isPro: [lease.isPro, [Validators.required]],
    });
    this.leases.push(leaseForm);
    this.toogleEdit(false);
  }

}
