import { Component, OnInit, ViewChild } from '@angular/core';
import { LeaseHolderClass, Leaseholder } from '../leaseholder';
import { StorageService } from '../storage-service.service';
import { IonModal } from '@ionic/angular';
import { OverlayEventDetail } from '@ionic/core/components';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { LeaseholderDetailsPage } from '../leaseholder-details/leaseholder-details.page';
import { Lease } from '../lease';
@Component({
  selector: 'app-tab-list',
  templateUrl: 'tab-list.page.html',
  styleUrls: ['tab-list.page.scss']
})
export class TabListPage implements OnInit {

  @ViewChild(IonModal) modal: IonModal | undefined;

  leaseholders: Leaseholder[] = [];
  message = 'This modal example uses triggers to automatically open a modal when the button is clicked.';
  name: string | undefined;
  newLeaseHolderForm!: FormGroup;

  constructor(
    private storageService: StorageService,
    private formBuilder: FormBuilder,
  ) { }

  async ngOnInit() {
    await this.storageService.getData(); 
    this.leaseholders = this.storageService.getLeaseholders();

    // Manage new lease form
    this.newLeaseHolderForm = this.formBuilder.group({
      name: ["", [Validators.required]],
      description: ["", [Validators.required]],
      phone: ["", [Validators.required]],
      email: ["", [Validators.required, Validators.email]],
    });

  }

  cancel() {
    this.modal?.dismiss(null, 'cancel');
  }

  confirm() {
    this.modal?.dismiss(this.name, 'confirm');
  }

  onSubmit() {
    const emptyLeases: Lease[] = [];
    const leaseHolder = new LeaseHolderClass(
      this.leaseholders.length+1,
      this.newLeaseHolderForm.controls["name"].value,
      this.newLeaseHolderForm.controls["description"].value,
      this.newLeaseHolderForm.controls["email"].value,
      this.newLeaseHolderForm.controls["phone"].value,
      emptyLeases,
    );

    this.storageService.addLeaseHolder(leaseHolder);
    this.leaseholders = this.storageService.getLeaseholders();
  }


  onWillDismiss(event: Event) {
    const ev = event as CustomEvent<OverlayEventDetail<string>>;
    if (ev.detail.role === 'confirm') {
      this.message = `Hello, ${ev.detail.data}!`;
    }
  }
}
