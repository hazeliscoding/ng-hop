import { Component, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { AcmeButton, AcmeCard } from '@acme/ui-core';
import { AcmeTextField } from '@acme/ui-forms';

interface Request {
  title: string;
  reason: string;
}

@Component({
  selector: 'app-root',
  imports: [AcmeButton, AcmeCard, AcmeTextField, ReactiveFormsModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly form = new FormGroup({
    title: new FormControl('', { nonNullable: true, validators: Validators.required }),
    reason: new FormControl('', { nonNullable: true }),
  });
  protected readonly requests = signal<Request[]>([{ title: 'Second monitor', reason: 'Design reviews' }]);

  protected submit(): void {
    if (this.form.invalid) return;
    this.requests.update((list) => [this.form.getRawValue(), ...list]);
    this.form.reset();
  }
}
