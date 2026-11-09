import { Component, forwardRef, input, signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { AcmeButton } from '@acme/ui-core';

/** A labelled text input for Angular forms, with a button to clear it. */
@Component({
  selector: 'acme-text-field',
  imports: [AcmeButton],
  template: `
    <label class="acme-field">
      <span class="acme-field__label">{{ label() }}</span>
      <input class="acme-field__input" [value]="value()" [disabled]="disabled()" (input)="update($any($event.target).value)" (blur)="touched()" />
    </label>
    @if (value() && !disabled()) {
      <acme-button variant="quiet" (click)="update('')">Clear</acme-button>
    }
  `,
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => AcmeTextField), multi: true }],
})
export class AcmeTextField implements ControlValueAccessor {
  readonly label = input.required<string>();
  protected readonly value = signal('');
  protected readonly disabled = signal(false);
  private changed: (value: string) => void = () => {};
  protected touched: () => void = () => {};

  writeValue(value: string | null): void { this.value.set(value ?? ''); }
  registerOnChange(fn: (value: string) => void): void { this.changed = fn; }
  registerOnTouched(fn: () => void): void { this.touched = fn; }
  setDisabledState(disabled: boolean): void { this.disabled.set(disabled); }

  protected update(value: string): void {
    this.value.set(value);
    this.changed(value);
  }
}
