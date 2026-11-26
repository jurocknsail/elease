import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
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
}
