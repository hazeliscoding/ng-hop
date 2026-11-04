// Queries for checking when the skill fires. The near-misses matter most: they share words with the skill but need
// something else. `test` queries are never used to tune the description, so they show whether it generalizes.
export const TRIGGER_QUERIES = [
  // ---- Should fire: different words for the same need, and cases that never say "upgrade" ------------------------
  { split: 'train', should_trigger: true, query: "we're stuck on angular 18 at work and my lead wants us on the latest by end of quarter. can you get this repo there? we've got primeng and ngrx in it" },
  { split: 'train', should_trigger: true, query: 'bump angular to 21 pls' },
  { split: 'train', should_trigger: true, query: `ng update @angular/core@21 fails with this:

Package "@ng-bootstrap/ng-bootstrap" has an incompatible peer dependency to "@angular/core" (requires "^20.0.0", would install "21.2.26").

what do i do` },
  { split: 'train', should_trigger: true, query: 'Before I commit to anything, how far could this app realistically go on Angular versions given the libraries it uses?' },
  { split: 'train', should_trigger: true, query: "does ng-zorro support angular 22 yet? trying to figure out if we can move this project up" },
  { split: 'train', should_trigger: true, query: 'Angular 20 reaches end of life this month and security is on my back. Please migrate this project to a supported version.' },
  { split: 'test', should_trigger: true, query: 'Take this project from Angular 20 to 22, one version at a time, and keep the dependencies in step.' },
  { split: 'test', should_trigger: true, query: "npm install is throwing ERESOLVE ever since i changed @angular/core to ^21 in package.json by hand. ag-grid-angular seems to be the problem. can you sort out this upgrade properly" },
  { split: 'test', should_trigger: true, query: 'is it safe to run ng update on this repo? what would break' },
  { split: 'test', should_trigger: true, query: 'can we get off this old angular version? everything in here feels ancient and the angular material deprecation warnings are getting loud' },

  // ---- Should stay quiet: near-misses that share its words -------------------------------------------------------
  { split: 'train', should_trigger: false, query: 'Convert the components in this project from *ngIf and *ngFor to the new @if and @for control flow. Stay on the current Angular version.' },
  { split: 'train', should_trigger: false, query: 'migrate our services in src/app to use inject() instead of constructor injection' },
  { split: 'train', should_trigger: false, query: 'bump lodash and date-fns to their latest versions in package.json, nothing else' },
  { split: 'train', should_trigger: false, query: "I have an old AngularJS 1.6 app with ng-controller everywhere. How do I start rewriting it in modern Angular?" },
  { split: 'train', should_trigger: false, query: 'npm audit is reporting a high severity issue in follow-redirects, can you fix it' },
  { split: 'test', should_trigger: false, query: 'add a PrimeNG data table to the dashboard page, with sorting and pagination' },
  { split: 'test', should_trigger: false, query: "What's new in Angular 22? Just curious what they added, I'm not planning to change anything in this project." },
  { split: 'test', should_trigger: false, query: 'Upgrade the Node version in our Dockerfile and GitHub Actions from 20 to 24.' },
  { split: 'test', should_trigger: false, query: 'our Angular app has a memory leak after navigating between routes a few times, can you find it' },
  { split: 'test', should_trigger: false, query: 'turn on zoneless change detection in this app and fix whatever that breaks' },
];
