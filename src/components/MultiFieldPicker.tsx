import React, { useMemo } from 'react';
import { StandardEditorProps } from '@grafana/data';
import { MultiSelect } from '@grafana/ui';

export interface MultiFieldPickerSettings {
  placeholder?: string;
}

// Generic multi-field picker for panel options — lists whatever columns
// this panel's own query actually returned, in result order, rather than
// hardcoding any particular concept (id, size, salesperson, ...). Reused
// for both "Unique row ID field(s)" (a compound de-dup key) and "Popup
// detail fields" (which columns to show in an alert popup, and in what
// order).
export const MultiFieldPicker: React.FC<StandardEditorProps<string[], MultiFieldPickerSettings>> = ({
  value,
  onChange,
  context,
  item,
}) => {
  const options = useMemo(() => {
    const names = Array.from(new Set((context.data?.[0]?.fields ?? []).map((f) => f.name)));
    return names.map((name) => ({ label: name, value: name }));
  }, [context.data]);

  return (
    <MultiSelect
      options={options}
      value={value ?? []}
      onChange={(selected) => onChange(selected.map((s) => s.value as string).filter((v): v is string => v != null))}
      placeholder={item.settings?.placeholder ?? 'Select field(s)'}
    />
  );
};
