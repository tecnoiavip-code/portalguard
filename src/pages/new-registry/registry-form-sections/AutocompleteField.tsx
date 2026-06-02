import { Dispatch, ReactNode, SetStateAction } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface AutocompleteFieldProps<TSuggestion> {
  id: string;
  name: string;
  label: string;
  value: string;
  placeholder: string;
  suggestions: TSuggestion[];
  showSuggestions: boolean;
  setShowSuggestions: Dispatch<SetStateAction<boolean>>;
  onValueChange: (value: string) => void;
  onSuggestionSelect: (suggestion: TSuggestion) => void;
  getSuggestionKey: (suggestion: TSuggestion) => string;
  renderSuggestion: (suggestion: TSuggestion) => ReactNode;
  autoComplete?: string;
  className?: string;
  required?: boolean;
  readOnlyUntilFocus?: boolean;
  maxSuggestions?: number;
  shouldShowSuggestions?: (value: string) => boolean;
  onBeforeOpen?: (value: string) => void;
}

export function AutocompleteField<TSuggestion>({
  id,
  name,
  label,
  value,
  placeholder,
  suggestions,
  showSuggestions,
  setShowSuggestions,
  onValueChange,
  onSuggestionSelect,
  getSuggestionKey,
  renderSuggestion,
  autoComplete = 'off',
  className,
  required,
  readOnlyUntilFocus,
  maxSuggestions,
  shouldShowSuggestions = () => true,
  onBeforeOpen,
}: AutocompleteFieldProps<TSuggestion>) {
  const visibleSuggestions = maxSuggestions ? suggestions.slice(0, maxSuggestions) : suggestions;

  const openSuggestions = (nextValue: string) => {
    onBeforeOpen?.(nextValue);
    setShowSuggestions(shouldShowSuggestions(nextValue));
  };

  return (
    <div className="space-y-2 relative">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        value={value}
        autoComplete={autoComplete}
        readOnly={readOnlyUntilFocus}
        className={className}
        onFocus={(event) => {
          if (readOnlyUntilFocus) event.currentTarget.removeAttribute('readOnly');
          openSuggestions(value);
        }}
        onChange={(event) => {
          const nextValue = event.target.value;
          onValueChange(nextValue);
          openSuggestions(nextValue);
        }}
        onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
        placeholder={placeholder}
        required={required}
      />
      {showSuggestions && visibleSuggestions.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-background border rounded-md shadow-lg max-h-40 overflow-y-auto">
          {visibleSuggestions.map(suggestion => (
            <button
              key={getSuggestionKey(suggestion)}
              type="button"
              className="w-full text-left px-3 py-1.5 hover:bg-accent transition-colors text-sm"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onSuggestionSelect(suggestion);
                setShowSuggestions(false);
              }}
            >
              {renderSuggestion(suggestion)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
