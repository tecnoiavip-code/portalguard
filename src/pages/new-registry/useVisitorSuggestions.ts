import { Dispatch, SetStateAction, useCallback, useState } from 'react';
import { toast } from 'sonner';

import { AccessEntry } from '@/types';

import { NewRegistryFormData } from './registry-form';

interface UseVisitorSuggestionsParams {
  allEntries: AccessEntry[];
  setFormData: Dispatch<SetStateAction<NewRegistryFormData>>;
}

export const useVisitorSuggestions = ({
  allEntries,
  setFormData,
}: UseVisitorSuggestionsParams) => {
  const [suggestions, setSuggestions] = useState<AccessEntry[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const clearSuggestions = useCallback(() => {
    setSuggestions([]);
    setShowSuggestions(false);
  }, []);

  const findSimilarEntries = useCallback(
    (name: string, document: string, plate?: string) => {
      const nameReady = name && name.trim().length >= 5;
      const docReady = document && document.replace(/\D/g, '').length >= 5;
      const plateReady = plate && plate.replace(/[^a-zA-Z0-9]/g, '').length >= 3;

      if (!nameReady && !docReady && !plateReady) {
        clearSuggestions();
        return;
      }

      const similar = allEntries.filter(entry => {
        const nameMatch = nameReady && entry.visitorName.toLowerCase().includes(name.toLowerCase());
        const docMatch = docReady && entry.visitorDocument.includes(document);
        const plateMatch =
          plateReady && entry.vehiclePlate && entry.vehiclePlate.toLowerCase().includes(plate!.toLowerCase());
        return nameMatch || docMatch || plateMatch;
      });

      const uniqueMap = new Map<string, AccessEntry>();
      for (const entry of similar) {
        const key = entry.visitorDocument || entry.visitorName;
        if (!uniqueMap.has(key)) {
          uniqueMap.set(key, entry);
        }
      }

      const unique = Array.from(uniqueMap.values());
      if (unique.length > 0) {
        setSuggestions(unique.slice(0, 3));
        setShowSuggestions(true);
      } else {
        setShowSuggestions(false);
      }
    },
    [allEntries, clearSuggestions]
  );

  const applySuggestion = useCallback(
    (entry: AccessEntry) => {
      setFormData(prev => ({
        ...prev,
        visitorName: entry.visitorName,
        visitorDocument: entry.visitorDocument,
        visitorType: entry.visitorType,
        company: entry.company || '',
        vehiclePlate: entry.vehiclePlate || '',
        vehicleModel: entry.vehicleModel || '',
        vehicleColor: entry.vehicleColor || '',
        photo: entry.photo || '',
        badgeNumber: '',
      }));
      setShowSuggestions(false);
      toast.success('Dados preenchidos automaticamente! Atribua um novo crachá.');
    },
    [setFormData]
  );

  return {
    suggestions,
    showSuggestions,
    findSimilarEntries,
    applySuggestion,
    clearSuggestions,
  };
};
