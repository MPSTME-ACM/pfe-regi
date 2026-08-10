'use client';

import React from 'react';

// The two primitive form controls, lifted out of RegistrationForm so the SKU
// chooser and the track selects can share them.
//
// SelectField used to sniff `name === 'domain'` to decide whether an option was
// disabled. It now takes options as objects, so "this one is full" is a property
// of the option rather than a special case keyed off the field's name.

interface InputFieldProps {
  label: string;
  type: string;
  placeholder: string;
  error?: string;
  name: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  required?: boolean;
  hint?: string;
}

export const InputField: React.FC<InputFieldProps> = ({
  label, type, placeholder, name, value, onChange, required = false, error, hint,
}) => (
  <div className="mb-6">
    <label htmlFor={name} className="block text-sm font-medium text-gray-300 mb-2">
      {label} {required && <span className="text-accent">*</span>}
    </label>
    <input
      type={type}
      id={name}
      name={name}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      required={required}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${name}-error` : hint ? `${name}-hint` : undefined}
      className="w-full bg-white/5 border border-white/20 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-accent-soft transition-all duration-300 autofill:!bg-white/5"
    />
    {hint && !error && <p id={`${name}-hint`} className="mt-1 text-xs text-gray-500">{hint}</p>}
    {error && <p id={`${name}-error`} className="text-red-500 text-xs mt-1">{error}</p>}
  </div>
);

export interface SelectOption {
  value: string;
  label: string;
  /** Rendered but unselectable — a full track must be visible, not missing. */
  disabled?: boolean;
  /** Optional <optgroup> label. Consecutive options sharing one are grouped. */
  group?: string;
}

interface SelectFieldProps {
  label: string;
  name: string;
  options: SelectOption[];
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  required?: boolean;
  placeholder?: string;
  hint?: string;
}

const CHEVRON =
  `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%23f8c8fc' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`;

/** Consecutive options with the same `group` collapse into one <optgroup>. */
function groupOptions(options: SelectOption[]): { label: string; items: SelectOption[] }[] {
  const groups: { label: string; items: SelectOption[] }[] = [];
  for (const option of options) {
    const label = option.group ?? '';
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(option);
    else groups.push({ label, items: [option] });
  }
  return groups;
}

export const SelectField: React.FC<SelectFieldProps> = ({
  label, name, options, value, onChange, required = false, placeholder = 'Select your option', hint,
}) => {
  const groups = groupOptions(options);

  const renderOption = (option: SelectOption) => (
    <option
      key={option.value}
      value={option.value}
      disabled={option.disabled}
      className="bg-[#1a0d1f] text-white disabled:text-gray-500"
    >
      {option.label}
    </option>
  );

  return (
    <div className="mb-6">
      <label htmlFor={name} className="block text-sm font-medium text-gray-300 mb-2">
        {label} {required && <span className="text-accent">*</span>}
      </label>
      <select
        id={name}
        name={name}
        value={value}
        onChange={onChange}
        required={required}
        aria-describedby={hint ? `${name}-hint` : undefined}
        className="w-full bg-white/5 border border-white/20 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-accent-soft appearance-none"
        style={{
          backgroundImage: CHEVRON,
          backgroundPosition: 'right 0.5rem center',
          backgroundRepeat: 'no-repeat',
          backgroundSize: '1.5em 1.5em',
          paddingRight: '2.5rem',
        }}
      >
        <option value="" disabled>{placeholder}</option>
        {groups.map((group) =>
          group.label
            ? (
              <optgroup key={group.label} label={group.label} className="bg-[#1a0d1f] text-gray-400">
                {group.items.map(renderOption)}
              </optgroup>
            )
            : group.items.map(renderOption),
        )}
      </select>
      {hint && <p id={`${name}-hint`} className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  );
};
