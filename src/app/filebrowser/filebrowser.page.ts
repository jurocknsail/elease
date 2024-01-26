import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Directory,  Filesystem } from '@capacitor/filesystem';
import { AlertController, isPlatform, ToastController } from '@ionic/angular';
import write_blob from 'capacitor-blob-writer';
import { PreviewAnyFile } from '@awesome-cordova-plugins/preview-any-file/ngx';

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
		private previewAnyFile: PreviewAnyFile,
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
							path: `${this.currentFolder}/${data.name}`,
              recursive: true
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

	async itemClicked(entry: File) {
    if (this.copyFile) {
      // TODO
    } else {
      // Open the file or folder
      if (entry.isFile) {
        this.openFile(entry);
      } else {
        let pathToOpen =
          this.currentFolder != '' ? this.currentFolder + '/' + entry.name : entry.name;
        let folder = encodeURIComponent(pathToOpen);
        this.router.navigateByUrl(`/filebrowser/${folder}`);
      }
    }
  }

  async openFile(entry: File) {
    if (isPlatform('hybrid')) {
      console.log("cordova")
      // Get the URI and use our Cordova plugin for preview
      const file_uri = await Filesystem.getUri({
        directory: APP_DIRECTORY,
        path: this.currentFolder + '/' + entry.name
      });

      this.previewAnyFile.preview(file_uri.uri)
        .then((res: any) => console.log(res))
        .catch((error: any) => console.error(error));
    } else {
      console.log("browser")

      // Browser fallback to download the file
      const file = await Filesystem.readFile({
        directory: APP_DIRECTORY,
        path: this.currentFolder + '/' + entry.name
      });

      console.log(file.data instanceof Blob)      

      const blob = this.b64toBlob(file.data, 'application/pdf');
      window.open(URL.createObjectURL(blob), "_blank");
      
      /*const blobUrl = URL.createObjectURL(blob);
      let a = document.createElement('a');
      document.body.appendChild(a);
      a.setAttribute('style', 'display: none');
      a.href = blobUrl;
      a.download = entry.name;
      a.click();
      window.URL.revokeObjectURL(blobUrl);
      a.remove();*/
    }
  }
  
  b64toBlob = (b64Data: any, contentType = '', sliceSize = 512) => {
    const byteCharacters = atob(b64Data);
	const byteArrays = [];

	for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
		const slice = byteCharacters.slice(offset, offset + sliceSize);

		const byteNumbers = new Array(slice.length);
		for (let i = 0; i < slice.length; i++) {
			byteNumbers[i] = slice.charCodeAt(i);
		}

		const byteArray = new Uint8Array(byteNumbers);
		byteArrays.push(byteArray);
	}

	const blob = new Blob(byteArrays, { type: contentType });
	return blob;
  };

	async delete(entry: any) {}

	startCopy(file: any) {}

	async finishCopyFile(entry: any) {}

}
