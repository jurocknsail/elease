import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { InstallService } from './core/pwa/install.service';
import { ThemeService } from './core/theme/theme.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class App {
  // Instantiated at startup so ThemeService keeps the theme in sync (toggle, OS changes, theme-color).
  // The first paint is handled by the inline script in index.html, which applies the persisted theme.
  private readonly theme = inject(ThemeService);
  // Instantiated at startup so the browser's `beforeinstallprompt` is captured before any screen asks.
  private readonly install = inject(InstallService);
}
