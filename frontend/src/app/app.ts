import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { FileUploadComponent } from './components/file-upload/file-upload.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, FileUploadComponent],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly title = signal('frontend');
}
