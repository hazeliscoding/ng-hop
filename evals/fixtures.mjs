// The real Angular apps that evals run against. Each is `ng new` at an old major, plus pinned libraries and a
// little code that really uses them, so a broken library API fails the build instead of passing silently.
const shell = (imports, template, extra = {}) => ({
  'src/app/app.ts': `import { Component } from '@angular/core';\n${imports.join('\n')}\n\n@Component({\n  selector: 'app-root',\n  imports: [${extra.componentImports || ''}],\n  template: \`<h1>Fixture app</h1>${template}\`,\n})\nexport class App {${extra.body || ''}}\n`,
  'src/app/app.spec.ts': `import { TestBed } from '@angular/core/testing';\nimport { App } from './app';\nimport { appConfig } from './app.config';\n\ndescribe('App', () => {\n  beforeEach(async () => {\n    await TestBed.configureTestingModule({ imports: [App], providers: appConfig.providers }).compileComponents();\n  });\n\n  it('renders its heading', async () => {\n    const fixture = TestBed.createComponent(App);\n    fixture.detectChanges();\n    await fixture.whenStable();\n    expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain('Fixture app');\n  });\n});\n`,
});

const config = (imports, providers) => ({
  'src/app/app.config.ts': `import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';\nimport { provideRouter } from '@angular/router';\nimport { routes } from './app.routes';\n${imports.join('\n')}\n\nexport const appConfig: ApplicationConfig = {\n  providers: [provideZoneChangeDetection({ eventCoalescing: true }), provideRouter(routes), ${providers.join(', ')}],\n};\n`,
});

// `ng new` from Angular 21 on makes zoneless apps with no zone.js installed.
const zonelessConfig = (imports, providers) => ({
  'src/app/app.config.ts': `import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';\nimport { provideRouter } from '@angular/router';\nimport { routes } from './app.routes';\n${imports.join('\n')}\n\nexport const appConfig: ApplicationConfig = {\n  providers: [provideBrowserGlobalErrorListeners(), provideRouter(routes), ${providers.join(', ')}],\n};\n`,
});

export const FIXTURES = {
  // Every library has a release for each major, and the numbers don't line up with Angular's.
  'clean-path': {
    angular: 20,
    install: ['primeng@20.4.0', '@primeuix/themes@1.2.5', '@ng-select/ng-select@20.7.0', 'ngx-mask@20.0.3'],
    files: {
      ...config(["import { providePrimeNG } from 'primeng/config';", "import Aura from '@primeuix/themes/aura';", "import { provideNgxMask } from 'ngx-mask';"], ['providePrimeNG({ theme: { preset: Aura } })', 'provideNgxMask()']),
      ...shell(
        ["import { ButtonModule } from 'primeng/button';", "import { NgSelectModule } from '@ng-select/ng-select';", "import { NgxMaskDirective } from 'ngx-mask';"],
        `<p-button label="Save" /><ng-select [items]="items" /><input mask="000-000" />`,
        { componentImports: 'ButtonModule, NgSelectModule, NgxMaskDirective', body: "\n  items = ['a', 'b'];\n" },
      ),
    },
  },

  // Nebular has no release for Angular 22, so this app can reach 21 and no further.
  'nebular-blocked': {
    angular: 20,
    // Not `@angular/animations@20`: it's deprecated from 20.2 on, so npm would pick 20.1.8, which pins Angular to 20.1.8.
    install: ['@angular/cdk@20', '@angular/animations@^20.3.0', '@nebular/theme@16.0.0', '@nebular/eva-icons@16.0.0', 'eva-icons@1.1.3'],
    files: {
      ...config(["import { importProvidersFrom } from '@angular/core';", "import { provideAnimations } from '@angular/platform-browser/animations';", "import { NbThemeModule, NbLayoutModule } from '@nebular/theme';"], ['provideAnimations()', "importProvidersFrom(NbThemeModule.forRoot({ name: 'default' }), NbLayoutModule)"]),
      ...shell(["import { NbButtonModule, NbCardModule, NbLayoutModule } from '@nebular/theme';"], `<nb-layout><nb-layout-column><nb-card><nb-card-body><button nbButton>Save</button></nb-card-body></nb-card></nb-layout-column></nb-layout>`, { componentImports: 'NbButtonModule, NbCardModule, NbLayoutModule' }),
    },
    styles: ['node_modules/@nebular/theme/styles/prebuilt/default.css'],
  },

  // The latest ngx-toastr rejects Angular 22, while an older release accepts it through an open-ended range.
  'toastr-trap': {
    angular: 21,
    install: ['@angular/animations@21', 'ngx-toastr@20.0.5'],
    files: {
      ...zonelessConfig(["import { provideAnimations } from '@angular/platform-browser/animations';", "import { provideToastr } from 'ngx-toastr';"], ['provideAnimations()', 'provideToastr()']),
      ...shell(["import { inject } from '@angular/core';", "import { ToastrService } from 'ngx-toastr';"], `<button (click)="show()">Show</button>`, { body: "\n  private toastr = inject(ToastrService);\n  show() { this.toastr.success('Saved'); }\n" }),
    },
  },

  // Angular Material ships migrations of its own, which installing it with npm would skip.
  'material-migrations': {
    angular: 20,
    install: ['@angular/cdk@20', '@angular/material@20'],
    files: {
      ...config([], []),
      ...shell(["import { MatButtonModule } from '@angular/material/button';", "import { MatCardModule } from '@angular/material/card';"], `<mat-card><mat-card-content><button matButton="filled">Save</button></mat-card-content></mat-card>`, { componentImports: 'MatButtonModule, MatCardModule' }),
    },
    styles: ['@angular/material/prebuilt-themes/azure-blue.css'],
  },

  // `ng update` crashes loading NgRx's old migrations, which stops the CLI's own migrations from running.
  'ngrx-crash': {
    angular: 20,
    install: ['@ngrx/store@20', '@ngrx/effects@20'],
    files: {
      'src/app/counter.ts': "import { createAction, createReducer, on } from '@ngrx/store';\n\nexport const add = createAction('add');\nexport const counter = createReducer(0, on(add, (n) => n + 1));\n",
      ...config(["import { provideStore } from '@ngrx/store';", "import { provideEffects } from '@ngrx/effects';", "import { counter } from './counter';"], ['provideStore({ counter })', 'provideEffects()']),
      ...shell(["import { inject } from '@angular/core';", "import { AsyncPipe } from '@angular/common';", "import { Store } from '@ngrx/store';", "import { add } from './counter';"], `<button (click)="bump()">{{ total$ | async }}</button>`, { componentImports: 'AsyncPipe', body: "\n  private store = inject(Store<{ counter: number }>);\n  total$ = this.store.select('counter');\n  bump() { this.store.dispatch(add()); }\n" }),
    },
  },

  // The chain from the first experiment: ngx-markdown drags marked along, marked drops the file angular.json
  // loads, and on Angular 22 the dev server breaks while the build and tests still pass.
  'markdown-chain': {
    angular: 20,
    install: ['ngx-markdown@20.1.0', 'marked@15.0.12', 'prismjs@1.30.0'],
    files: {
      ...config(["import { provideMarkdown } from 'ngx-markdown';"], ['provideMarkdown()']),
      ...shell(["import { MarkdownComponent } from 'ngx-markdown';"], `<markdown [data]="text" />`, { componentImports: 'MarkdownComponent', body: "\n  text = '# Hello';\n" }),
    },
    scripts: ['node_modules/marked/marked.min.js', 'node_modules/prismjs/prism.js'],
  },

  // A test was already failing before any upgrade. The upgrade must not take the blame, or "fix" it.
  'broken-spec': {
    angular: 20,
    install: [],
    files: {
      ...config([], []),
      ...shell([], ''),
      'src/app/legacy.spec.ts': "describe('legacy behaviour', () => {\n  it('still returns the old total', () => {\n    expect(1 + 1).toBe(3);\n  });\n});\n",
    },
    expectBaselineTestFailure: true,
  },

  // The new library line is only accepted through an open-ended range, and it needs its community package moved too.
  'ag-grid-open': {
    angular: 20,
    install: ['ag-grid-community@34.3.1', 'ag-grid-angular@34.3.1'],
    noBudgets: true, // AG Grid alone is past the default bundle budget, which has nothing to do with upgrading.
    files: {
      ...config([], []),
      ...shell(["import { AgGridAngular } from 'ag-grid-angular';", "import { AllCommunityModule, ColDef, ModuleRegistry } from 'ag-grid-community';", '', 'ModuleRegistry.registerModules([AllCommunityModule]);'], `<ag-grid-angular style="height: 200px" [rowData]="rows" [columnDefs]="cols" />`, { componentImports: 'AgGridAngular', body: "\n  rows = [{ a: 1 }];\n  cols: ColDef[] = [{ field: 'a' }];\n" }),
    },
  },

  // Two small hops with nothing in the way, used to test what happens around the upgrade itself.
  'plain-20': { angular: 20, install: [], files: { ...config([], []), ...shell([], '') } },
  'plain-22': { angular: 22, install: [], files: {}, keepNgNewFiles: true },
};

// pnpm 11 and newer need install scripts decided, so a real project has this file. It's also what makes pnpm treat the
// CLI's temporary folder as part of the project, which is how a clean tree turns dirty during `ng update`.
const decidedScripts = "allowBuilds:\n  '@parcel/watcher': true\n  esbuild: true\n  lmdb: true\n  msgpackr-extract: true\n";
const cleanPath = FIXTURES['clean-path'];
FIXTURES['pnpm-clean'] = { ...cleanPath, packageManager: 'pnpm', files: { ...cleanPath.files, 'pnpm-workspace.yaml': decidedScripts } };
// Nobody has decided about install scripts, so every install exits 1 until someone does.
FIXTURES['pnpm-undecided'] = { ...FIXTURES['plain-20'], packageManager: 'pnpm', undecidedScripts: true };
// Angular comes from a catalog. Through Angular 21's CLI, `ng update` skips it, moves the libraries and exits 0.
FIXTURES['pnpm-catalog'] = { ...FIXTURES['pnpm-clean'], catalog: true };
