import * as RadioGroup from '@radix-ui/react-radio-group';
import * as Switch from '@radix-ui/react-switch';
import { Minus, Plus } from 'lucide-react';
import { useId, type ReactNode } from 'react';

type SettingsPageHeaderProps = {
  description: string;
  title: string;
};

export function SettingsPageHeader({
  description,
  title,
}: SettingsPageHeaderProps) {
  return (
    <header className="lm-settings-page-header">
      <h2>{title}</h2>
      <p>{description}</p>
    </header>
  );
}

type SettingsGroupProps = {
  children: ReactNode;
  title: string;
};

export function SettingsGroup({ children, title }: SettingsGroupProps) {
  const titleId = useId();

  return (
    <section aria-labelledby={titleId} className="lm-settings-group">
      <h3 id={titleId}>{title}</h3>
      <div className="lm-settings-group-content">{children}</div>
    </section>
  );
}

type SettingRowProps = {
  children: ReactNode;
  description?: string;
  label: string;
  labelFor?: string;
};

export function SettingRow({
  children,
  description,
  label,
  labelFor,
}: SettingRowProps) {
  return (
    <div className="lm-setting-row">
      <div className="lm-setting-copy">
        {labelFor ? (
          <label className="lm-setting-label" htmlFor={labelFor}>
            {label}
          </label>
        ) : (
          <span className="lm-setting-label">{label}</span>
        )}
        {description ? (
          <p className="lm-setting-description">{description}</p>
        ) : null}
      </div>
      <div className="lm-setting-control">{children}</div>
    </div>
  );
}

type SettingsSwitchProps = {
  checked: boolean;
  description?: string;
  label: string;
  onCheckedChange: (checked: boolean) => void;
};

export function SettingsSwitch({
  checked,
  description,
  label,
  onCheckedChange,
}: SettingsSwitchProps) {
  const controlId = useId();

  return (
    <SettingRow description={description} label={label} labelFor={controlId}>
      <Switch.Root
        aria-label={label}
        checked={checked}
        className="lm-settings-switch"
        id={controlId}
        onCheckedChange={onCheckedChange}
      >
        <Switch.Thumb className="lm-settings-switch-thumb" />
      </Switch.Root>
    </SettingRow>
  );
}

export type SettingsRadioOption<TValue extends string> = {
  label: string;
  value: TValue;
};

type SettingsRadioGroupProps<TValue extends string> = {
  label: string;
  onValueChange: (value: TValue) => void;
  options: readonly SettingsRadioOption<TValue>[];
  value: TValue;
  variant?: 'pageWidthCards' | 'segmented' | 'themeCards';
};

export function SettingsRadioGroup<TValue extends string>({
  label,
  onValueChange,
  options,
  value,
  variant = 'segmented',
}: SettingsRadioGroupProps<TValue>) {
  return (
    <RadioGroup.Root
      aria-label={label}
      className={`lm-settings-radio-group lm-settings-radio-group-${variant}`}
      onValueChange={(nextValue) => {
        const selectedOption = options.find(
          (option) => option.value === nextValue,
        );
        if (selectedOption) {
          onValueChange(selectedOption.value);
        }
      }}
      value={value}
    >
      {options.map((option) => (
        <RadioGroup.Item
          className="lm-settings-radio-option"
          data-value={option.value}
          key={option.value}
          value={option.value}
        >
          {variant === 'themeCards' ? (
            <span
              aria-hidden="true"
              className="lm-settings-theme-preview"
              data-lm-settings-theme-preview=""
              data-preview={option.value}
            >
              <span />
            </span>
          ) : null}
          {variant === 'pageWidthCards' ? (
            <span
              aria-hidden="true"
              className="lm-settings-page-width-preview"
              data-lm-settings-page-width-preview=""
              data-preview={option.value}
            >
              <span />
            </span>
          ) : null}
          <RadioGroup.Indicator
            aria-hidden="true"
            className="lm-settings-radio-indicator"
          />
          <span>{option.label}</span>
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}

type ZoomStepperProps = {
  decreaseLabel: string;
  description: string;
  draft: string;
  increaseLabel: string;
  label: string;
  max: number;
  min: number;
  onBlur: () => void;
  onDraftChange: (draft: string) => void;
  onValueChange: (value: number) => void;
  step: number;
  value: number;
};

export function ZoomStepper({
  decreaseLabel,
  description,
  draft,
  increaseLabel,
  label,
  max,
  min,
  onBlur,
  onDraftChange,
  onValueChange,
  step,
  value,
}: ZoomStepperProps) {
  return (
    <SettingRow description={description} label={label}>
      <div className="lm-settings-zoom-stepper">
        <button
          aria-label={decreaseLabel}
          className="lm-icon-button"
          disabled={value <= min}
          onClick={() => {
            onValueChange(Math.max(min, value - step));
          }}
          type="button"
        >
          <Minus aria-hidden="true" size={15} />
        </button>
        <input
          aria-label={label}
          aria-valuemax={max}
          aria-valuemin={min}
          aria-valuenow={value}
          max={max}
          min={min}
          onBlur={onBlur}
          onChange={(event) => {
            onDraftChange(event.currentTarget.value);
          }}
          step={step}
          type="number"
          value={draft}
        />
        <button
          aria-label={increaseLabel}
          className="lm-icon-button"
          disabled={value >= max}
          onClick={() => {
            onValueChange(Math.min(max, value + step));
          }}
          type="button"
        >
          <Plus aria-hidden="true" size={15} />
        </button>
      </div>
    </SettingRow>
  );
}
