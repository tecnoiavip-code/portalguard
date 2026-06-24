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
        const normalizeStr = (str: string) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        
        const nameMatch = nameReady && normalizeStr(entry.visitorName).includes(normalizeStr(name));
        
        const cleanDoc = (doc: string) => doc.replace(/\D/g, '');
        const docMatch = docReady && cleanDoc(entry.visitorDocument).includes(cleanDoc(document));
        
        const cleanPlate = (p: string) => p.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
        const plateMatch = plateReady && entry.vehiclePlate && cleanPlate(entry.vehiclePlate).includes(cleanPlate(plate!));
        
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
