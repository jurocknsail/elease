import { Component, OnInit, ViewChild } from '@angular/core';
import { LeaseHolderClass, Leaseholder } from '../leaseholder';
import { IonModal, LoadingController, ToastController } from '@ionic/angular';
import { OverlayEventDetail } from '@ionic/core/components';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Lease } from '../lease';
import { ParseService } from "../parse-service.service";
import * as Parse from 'parse';
import { Router } from "@angular/router";
import { MenuController } from '@ionic/angular';

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
    private menuController: MenuController,
    private loadingController: LoadingController,
    private toastController: ToastController
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
    this.parseService.clearData();
    const user = await Parse.User.logOut();
    await this.menuController.close();
    await this.router.navigate(["/login"]);
    console.log('Logged out', user);
  }

  async export() {
    this.downloadFile(this.parseService.getLeaseholders());
    await this.menuController.close();
  }

  private downloadFile(data: Leaseholder[]) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    //window.open(URL.createObjectURL(blob), "_blank");

    const url = URL.createObjectURL(blob);

    // Create a link element
    const a = document.createElement('a');
    a.href = url;
    a.download = 'elease-backup-' + Parse.User.current()?.getUsername() + "-" + new Date().toLocaleString().replace(" ", "-").trim(); + '.json'; // File name
    document.body.appendChild(a);
    a.click();

    // Clean up
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }


  // Method to trigger the file input click
  async triggerFileInput() {
    await this.menuController.close();
    const fileInput = document.getElementById('fileInput') as HTMLInputElement;
    fileInput.click();
  }

  // Method to handle file input change event
  async handleFileInput(event: Event) {

    // Show loading overlay
    const loading = await this.loadingController.create({
      message: 'Importation des données ...'
    });
    await loading.present();

    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          if (e.target != null) {

            let leaseHolders = [] as Leaseholder[];
            leaseHolders = JSON.parse(e.target.result as string);
            console.log('Imported JSON:', leaseHolders);


            // Save the JSON data in DB

            let leaseholderPromises: Promise<void>[] = []
            let leasePromises: Promise<void>[] = []

            leaseHolders.forEach((lh) => {
              const myLeaseHolderPromise: Promise<void> = new Promise(async (resolveLeaseholder) => {
                this.parseService.createLeaseholder(lh).then((createdLH) => {
                  lh.leases.forEach((l) => {
                    const myLeasePromise: Promise<void> = new Promise(async (resolveLease) => {
                      if (createdLH.objectId) {
                        await this.parseService.addLeaseToHolder(createdLH.objectId, l);
                        resolveLease();
                      }
                    });
                    leasePromises.push(myLeasePromise);
                  });
                  resolveLeaseholder();
                });
              });
              leaseholderPromises.push(myLeaseHolderPromise);
            });

            Promise.all(leaseholderPromises).then(() => {
              console.log("Import Leaseholders terminated.");
              Promise.all(leasePromises).then(() => {
                console.log("Import Leases terminated.");
                loading.dismiss();

                // Show success message
                const toast = this.toastController.create({
                  message: 'Données importées avec succès ! 😊',
                  duration: 2000,
                  position: "middle",
                  color: 'success',
                  icon: "send"
                });

                toast.then((t) => {
                  t.onDidDismiss().then(() => {
                    //Force refresh
                    window.location.reload();
                  });
                  t.present();
                })

              });
            });

          }
        } catch (error) {
          console.error('Error parsing JSON:', error);
          loading.dismiss();

          const toast = this.toastController.create({
            message: "Une erreur est survenue, recommence !",
            duration: 3000,
            position: "middle",
            color: 'danger',
            icon: "warning"
          });
          toast.then((t) => {
            t.present();
          })
        }
      };
      reader.readAsText(file);
    }
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
