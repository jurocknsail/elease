import {Component, OnInit, ViewChild} from '@angular/core';
import {ActivatedRoute} from '@angular/router';
import {FormArray, FormBuilder, FormGroup, Validators} from '@angular/forms';
import {AdditionalCharge, Lease, LeaseClass} from '../model/lease';
import {ActionSheetController, AlertController, IonAccordionGroup, IonButton, IonModal, LoadingController, ToastController} from '@ionic/angular';
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
  selectedSegment = 'leases';
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
    private loadingController: LoadingController,
    private toastController: ToastController,
    private actionSheetController: ActionSheetController,
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
      additionalCharges: this.formBuilder.array([] as FormGroup[]),
    });

    this.toogleEdit(false);

  }

  // Getter for leases forms
  get leases(): FormArray {
    return this.leaseForm.controls["leases"] as FormArray;
  }

  // Getter for new lease additional charges
  get newLeaseAdditionalCharges(): FormArray {
    return this.newLeaseForm.controls["additionalCharges"] as FormArray;
  }

  // Helper to get additional charges form array from a specific lease
  getAdditionalCharges(leaseIndex: number): FormArray {
    return this.leases.at(leaseIndex).get("additionalCharges") as FormArray;
  }

  onEdit() {
    if (this.isEditing) {
      this.onCancel();
    } else {
      this.isEditing = true;
      this.toogleEdit(true);
    }
  }

  onCancel() {
    this.isEditing = false;
    this.toogleEdit(false);
    // Re-initialize forms with current leaseholder data to revert changes
    this.ngOnInit();
  }

  async presentActionSheet() {
    const actionSheet = await this.actionSheetController.create({
      header: 'Actions',
      buttons: [
        {
          text: 'Supprimer le locataire',
          role: 'destructive',
          icon: 'trash',
          handler: () => {
            this.onDelete();
          },
        },
        {
          text: 'Annuler',
          role: 'cancel',
          icon: 'close',
        },
      ],
    });
    await actionSheet.present();
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
    const loading = await this.loadingController.create({
      message: 'Suppression...',
      backdropDismiss: false
    });
    await loading.present();

    try {
      await this.parseService.deleteLeaseholder(this.leaseholder.objectId);
      const toast = await this.toastController.create({
        message: 'Locataire supprimé',
        duration: 2000,
        color: 'success',
        position: 'bottom'
      });
      await toast.present();
      this.location.back();
    } catch (error) {
      console.error('Error deleting leaseholder:', error);
      const toast = await this.toastController.create({
        message: 'Erreur lors de la suppression',
        duration: 3000,
        color: 'danger',
        position: 'bottom'
      });
      await toast.present();
    } finally {
      await loading.dismiss();
    }
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

  async presentInseeErrorAlert(): Promise<boolean> {
    return new Promise(async (resolve) => {
      const alert = await this.alertController.create({
        header: 'Erreur Indice INSEE',
        message: 'Impossible de récupérer l\'indice INSEE (clé API non configurée ou erreur réseau). Voulez-vous créer le bail sans cette information ?',
        buttons: [
          {
            text: 'Annuler',
            role: 'cancel',
            handler: () => {
              this.accordionGroup.value = undefined; // Close the accordion
              resolve(false);
            }
          },
          {
            text: 'Accepter',
            role: 'confirm',
            handler: () => {
              resolve(true);
            }
          }
        ]
      });
      await alert.present();
    });
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

  async deleteLease(leaseId: string, leaseFormIndex: number) {
    const loading = await this.loadingController.create({
      message: 'Suppression du bail...',
      backdropDismiss: false
    });
    await loading.present();

    try {
      console.log(leaseId + "/" + leaseFormIndex)
      this.leases.controls.splice(leaseFormIndex, 1);
      await this.parseService.deleteLeaseFromHolder(this.leaseholder.objectId, leaseId);

      const toast = await this.toastController.create({
        message: 'Bail supprimé',
        duration: 2000,
        color: 'success',
        position: 'bottom'
      });
      await toast.present();
    } catch (error) {
      console.error('Error deleting lease:', error);
      const toast = await this.toastController.create({
        message: 'Erreur lors de la suppression du bail',
        duration: 3000,
        color: 'danger',
        position: 'bottom'
      });
      await toast.present();
    } finally {
      await loading.dismiss();
    }
  }

  // On edit lease/leaseholder form save
  async onSave(): Promise<void> {
    const loading = await this.loadingController.create({
      message: 'Enregistrement...',
      backdropDismiss: false
    });
    await loading.present();

    try {
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
        this.leaseholder.leases[index].postalCode = Number(control.get("postalCode")?.value);
        this.leaseholder.leases[index].city = control.get("city")?.value;
        this.leaseholder.leases[index].renewalDate = new Date(control.get("renewalDate")?.value).getTime();
        this.leaseholder.leases[index].indexing = control.get("indexing")?.value;
        this.leaseholder.leases[index].price = control.get("price")?.value;
        this.leaseholder.leases[index].charge = control.get("charge")?.value;
        this.leaseholder.leases[index].isPro = control.get("isPro")?.value;

        // Save additional charges
        const additionalChargesArray = this.getAdditionalCharges(index);
        const additionalCharges: AdditionalCharge[] = [];
        additionalChargesArray.controls.forEach((chargeControl) => {
          const title = chargeControl.get("title")?.value;
          const amount = chargeControl.get("amount")?.value;
          if (title && amount) {
            additionalCharges.push({ title, amount });
          }
        });
        this.leaseholder.leases[index].additionalCharges = additionalCharges;
      });

      await this.parseService.updateLeaseholder(this.leaseholder);

      const toast = await this.toastController.create({
        message: 'Modifications enregistrées !',
        duration: 2000,
        color: 'success',
        position: 'bottom'
      });
      await toast.present();
    } catch (error) {
      console.error('Error saving leaseholder:', error);
      const toast = await this.toastController.create({
        message: 'Erreur lors de l\'enregistrement',
        duration: 3000,
        color: 'danger',
        position: 'bottom'
      });
      await toast.present();
    } finally {
      await loading.dismiss();
    }
  }

  // On ADD form Submit actions
  async onAdd() {
    const loading = await this.loadingController.create({
      message: 'Ajout du bail...',
      backdropDismiss: false
    });

    const isPro : boolean = this.newLeaseForm.controls["isPro"].value;
    let indexing : number = 0;

    try {
      if(isPro){
        if(this.inseeService.lastILATValue != 0 ) {
          indexing = this.inseeService.lastILATValue;
        } else {
          await loading.present();
          indexing = await this.inseeService.getILATData();
        }
        console.log("Lease is set as Pro, using ILAT Index : " + indexing);
      } else {
        if(this.inseeService.lastIRLValue != 0 ) {
          indexing = this.inseeService.lastIRLValue;
        } else {
          await loading.present();
          indexing = await this.inseeService.getIRLData();
        }
        console.log("Lease is NOT set as Pro, using IRL Index : " + indexing);
      }
    } catch (error) {
      console.error("Failed to fetch INSEE data:", error);
      if (loading) await loading.dismiss();
      const confirmed = await this.presentInseeErrorAlert();
      if (!confirmed) {
        return;
      }
    }

    if (!loading.parentElement) {
      await loading.present();
    }

    try {
      // Build additional charges array from form
      const additionalCharges: AdditionalCharge[] = [];
      this.newLeaseAdditionalCharges.controls.forEach((chargeControl) => {
        const title = chargeControl.get("title")?.value;
        const amount = chargeControl.get("amount")?.value;
        if (title && amount) {
          additionalCharges.push({ title, amount });
        }
      });

      // Add lease to model
      let addedLease = new LeaseClass(
        this.newLeaseForm.controls["name"].value,
        this.newLeaseForm.controls["lot"].value,
        this.newLeaseForm.controls["streetNumber"].value,
        this.newLeaseForm.controls["streetName"].value,
        this.newLeaseForm.controls["optionalAddressInfo"].value,
        Number(this.newLeaseForm.controls["postalCode"].value),
        this.newLeaseForm.controls["city"].value,
        0,
        new Date().getTime(),
        indexing,
        this.newLeaseForm.controls["price"].value,
        this.newLeaseForm.controls["charge"].value,
        this.newLeaseForm.controls["isPro"].value,
        additionalCharges,
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

      const toast = await this.toastController.create({
        message: 'Bail ajouté avec succès !',
        duration: 2000,
        color: 'success',
        position: 'bottom'
      });
      await toast.present();
    } catch (error) {
      console.error('Error adding lease:', error);
      const toast = await this.toastController.create({
        message: 'Erreur lors de l\'ajout du bail',
        duration: 3000,
        color: 'danger',
        position: 'bottom'
      });
      await toast.present();
    } finally {
      await loading.dismiss();
    }
  }

  private toogleEdit(edit: boolean) {
    if (edit) {
      Object.keys(this.leaseholderForm.controls).forEach(key => {
        this.leaseholderForm.get(key)?.enable();
      });
      Object.keys(this.leases.controls).forEach(key => {
        Object.keys((this.leases.get(key) as FormGroup).controls).forEach(controlKey => {
          (this.leases.get(key) as FormGroup).get(controlKey)?.enable();
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

    // Build additional charges form array
    const additionalChargesArray = this.formBuilder.array([] as FormGroup[]);
    if (lease.additionalCharges) {
      lease.additionalCharges.forEach((charge: AdditionalCharge) => {
        additionalChargesArray.push(this.createAdditionalChargeFormGroup(charge));
      });
    }

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
      additionalCharges: additionalChargesArray,
    });
    this.leases.push(leaseForm);
    this.toogleEdit(false);
  }

  // Create form group for an additional charge
  private createAdditionalChargeFormGroup(charge?: AdditionalCharge): FormGroup {
    return this.formBuilder.group({
      title: [charge?.title || '', [Validators.required]],
      amount: [charge?.amount || '', [Validators.required]],
    });
  }

  // Add additional charge to existing lease form
  addAdditionalChargeToLease(leaseIndex: number): void {
    this.getAdditionalCharges(leaseIndex).push(this.createAdditionalChargeFormGroup());
  }

  // Remove additional charge from existing lease form
  removeAdditionalChargeFromLease(leaseIndex: number, chargeIndex: number): void {
    this.getAdditionalCharges(leaseIndex).removeAt(chargeIndex);
  }

  // Add additional charge to new lease form
  addAdditionalChargeToNewLease(): void {
    this.newLeaseAdditionalCharges.push(this.createAdditionalChargeFormGroup());
  }

  // Remove additional charge from new lease form
  removeAdditionalChargeFromNewLease(chargeIndex: number): void {
    this.newLeaseAdditionalCharges.removeAt(chargeIndex);
  }

}
