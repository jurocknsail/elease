import { Component, OnInit, ViewChild } from '@angular/core';
import { LeaseHolderClass, Leaseholder } from '../leaseholder';
import { IonModal } from '@ionic/angular';
import { OverlayEventDetail } from '@ionic/core/components';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Lease } from '../lease';
import {ParseService} from "../parse-service.service";
import * as Parse from 'parse';
import {Router} from "@angular/router";

@Component({
  selector: 'app-tab-list',
  templateUrl: 'tab-list.page.html',
  styleUrls: ['tab-list.page.scss']
})
export class TabListPage implements OnInit {

  @ViewChild(IonModal) modal: IonModal | undefined;

  message = 'This modal example uses triggers to automatically open a modal when the button is clicked.';
  name: string | undefined;
  newLeaseHolderForm!: FormGroup;
  leaseholders: Leaseholder[] = [];

  constructor(
    public parseService: ParseService,
    private formBuilder: FormBuilder,
    private router: Router,
  ) { }

  async ngOnInit() {

    await this.parseService.fetchLeaseholders();
    this.leaseholders = this.parseService.getLeaseholders()

    // Manage new lease form
    this.newLeaseHolderForm = this.formBuilder.group({
      name: ["", [Validators.required]],
      description: ["", [Validators.required]],
      phone: ["", [Validators.required]],
      email: ["", [Validators.required, Validators.email]],
    });

  }

  async logout() {
    const user = await Parse.User.logOut();
    await this.router.navigate(["/login"]);
    console.log('Logged out', user);
  }

  export() {
    this.downloadFile(this.parseService.getLeaseholders())
  }

  private downloadFile(data: Leaseholder[]) {
    const blob = new Blob([JSON.stringify(data)], {type: 'application/json'});
    window.open(URL.createObjectURL(blob), "_blank");
  }

  import() {
    console.log("Import")
  }

  cancel() {
    this.modal?.dismiss(null, 'cancel');
  }

  confirm() {
    this.modal?.dismiss(this.name, 'confirm');
  }

  onSubmit() {
    if (this.newLeaseHolderForm.valid) {
      const emptyLeases: Lease[] = [];
      const leaseHolder = new LeaseHolderClass(
        this.newLeaseHolderForm.controls["name"].value,
        this.newLeaseHolderForm.controls["description"].value,
        this.newLeaseHolderForm.controls["email"].value,
        this.newLeaseHolderForm.controls["phone"].value,
        emptyLeases,
      );
      this.parseService.createLeaseholder(leaseHolder);
    }
  }


  onWillDismiss(event: Event) {
    const ev = event as CustomEvent<OverlayEventDetail<string>>;
    if (ev.detail.role === 'confirm') {
      this.message = `Hello, ${ev.detail.data}!`;
    }
  }
}
