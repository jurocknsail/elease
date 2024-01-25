import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Directory,  Filesystem } from '@capacitor/filesystem';
import { AlertController, isPlatform, ToastController } from '@ionic/angular';
import write_blob from 'capacitor-blob-writer';

const APP_DIRECTORY = Directory.Documents;

type File = {
  name: string;
  isFile: boolean;
};

@Component({
  selector: 'app-filebrowser',
  templateUrl: './filebrowser.page.html',
  styleUrls: ['./filebrowser.page.scss'],
})
export class FilebrowserPage implements OnInit {

  folderContent : any[] = [];
	currentFolder = '';
	copyFile = null;
	@ViewChild('filepicker') uploader!: ElementRef;
  

	constructor(
		private route: ActivatedRoute,
		private alertCtrl: AlertController,
		private router: Router,
		//private previewAnyFile: PreviewAnyFile,
		private toastCtrl: ToastController
	) {}

	ngOnInit() {
		this.currentFolder = this.route.snapshot.paramMap.get('folder') || '';
		this.loadDocuments();
	}

	async loadDocuments() {
		const folderContent = await Filesystem.readdir({
			directory: APP_DIRECTORY,
			path: this.currentFolder
		});

		// The directory array is just strings
		// We add the information isFile to make life easier
		this.folderContent = folderContent.files.map((file) => {
      console.log("AAAAA " + file.name)
			return {
				name: file.name,
				isFile: file.type === 'file'
			};
		});
	}

	async createFolder() {
		let alert = await this.alertCtrl.create({
			header: 'Create folder',
			message: 'Please specify the name of the new folder',
			inputs: [
				{
					name: 'name',
					type: 'text',
					placeholder: 'MyDir'
				}
			],
			buttons: [
				{
					text: 'Cancel',
					role: 'cancel'
				},
				{
					text: 'Create',
					handler: async (data) => {
						await Filesystem.mkdir({
							directory: APP_DIRECTORY,
							path: `${this.currentFolder}/${data.name}`
						});
						this.loadDocuments();
					}
				}
			]
		});

		await alert.present();
	}

	addFile() {}

	async fileSelected($event: any) {}

	async itemClicked(entry: any) {}

	async openFile(entry: any) {}
	b64toBlob = (b64Data: any, contentType = '', sliceSize = 512) => {};

	async delete(entry: any) {}

	startCopy(file: any) {}

	async finishCopyFile(entry: any) {}

}
