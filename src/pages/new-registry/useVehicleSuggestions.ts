import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { VEHICLE_SUGGESTIONS_CACHE_KEY } from './registry-form';

interface VehicleSuggestions {
  models: string[];
  colors: string[];
  companies: string[];
}

const normalizeVehicleSuggestions = (values: Array<string | null | undefined>) =>
  [...new Set(values.map(value => String(value ?? '').trim().toUpperCase()))]
    .filter((value): value is string => Boolean(value))
    .sort();

export function useVehicleSuggestions() {
  const [vehicleModelSuggestions, setVehicleModelSuggestions] = useState<string[]>([]);
  const [vehicleColorSuggestions, setVehicleColorSuggestions] = useState<string[]>([]);
  const [companySuggestions, setCompanySuggestions] = useState<string[]>([]);
  const [allVehicleModels, setAllVehicleModels] = useState<string[]>([]);
  const [allVehicleColors, setAllVehicleColors] = useState<string[]>([]);
  const [allCompanies, setAllCompanies] = useState<string[]>([]);

  const loadVehicleSuggestions = useCallback(async (): Promise<VehicleSuggestions> => {
    const [entryModelsRes, entryColorsRes, residentModelsRes, residentColorsRes, companiesRes] = await Promise.all([
      supabase.from('access_entries').select('vehicle_model').not('vehicle_model', 'is', null).not('vehicle_model', 'eq', '').order('entry_time', { ascending: false }).limit(300),
      supabase.from('access_entries').select('vehicle_color').not('vehicle_color', 'is', null).not('vehicle_color', 'eq', '').order('entry_time', { ascending: false }).limit(300),
      supabase.from('residents').select('vehicle_model').not('vehicle_model', 'is', null).not('vehicle_model', 'eq', '').order('created_at', { ascending: false }).limit(300),
      supabase.from('residents').select('vehicle_color').not('vehicle_color', 'is', null).not('vehicle_color', 'eq', '').order('created_at', { ascending: false }).limit(300),
      supabase.from('access_entries').select('company').not('company', 'is', null).not('company', 'eq', '').order('entry_time', { ascending: false }).limit(300),
    ]);

    const models = normalizeVehicleSuggestions([
      ...(entryModelsRes.data || []).map(r => r.vehicle_model),
      ...(residentModelsRes.data || []).map(r => r.vehicle_model),
    ]);
    const colors = normalizeVehicleSuggestions([
      ...(entryColorsRes.data || []).map(r => r.vehicle_color),
      ...(residentColorsRes.data || []).map(r => r.vehicle_color),
    ]);
    const companies = normalizeVehicleSuggestions((companiesRes.data || []).map(r => r.company));

    setAllVehicleModels(models);
    setAllVehicleColors(colors);
    setAllCompanies(companies);
    setVehicleModelSuggestions(models.slice(0, 8));
    setVehicleColorSuggestions(colors.slice(0, 8));
    setCompanySuggestions(companies.slice(0, 8));

    return { models, colors, companies };
  }, []);

  const loadVehicleSuggestionsWithCache = useCallback(async () => {
    const now = Date.now();

    try {
      const cached = localStorage.getItem(VEHICLE_SUGGESTIONS_CACHE_KEY);
      if (cached) {
        const { data, timestamp } = JSON.parse(cached);
        if (now - timestamp < 3600000) {
          setAllVehicleModels(data.models || []);
          setAllVehicleColors(data.colors || []);
          setAllCompanies(data.companies || []);
          setCompanySuggestions((data.companies || []).slice(0, 8));
          return;
        }
      }
    } catch {
      // ignore cache errors
    }

    const suggestions = await loadVehicleSuggestions();

    try {
      localStorage.setItem(VEHICLE_SUGGESTIONS_CACHE_KEY, JSON.stringify({
        data: {
          models: suggestions.models,
          colors: suggestions.colors,
          companies: suggestions.companies,
        },
        timestamp: now,
      }));
    } catch {
      // ignore cache save errors
    }
  }, [loadVehicleSuggestions]);

  useEffect(() => {
    loadVehicleSuggestionsWithCache();
  }, [loadVehicleSuggestionsWithCache]);

  const filterVehicleModels = useCallback((query: string) => {
    if (!query) {
      setVehicleModelSuggestions(allVehicleModels.slice(0, 8));
      return;
    }
    const q = query.toUpperCase();
    setVehicleModelSuggestions(allVehicleModels.filter(m => m.includes(q)).slice(0, 8));
  }, [allVehicleModels]);

  const filterVehicleColors = useCallback((query: string) => {
    if (!query) {
      setVehicleColorSuggestions(allVehicleColors.slice(0, 8));
      return;
    }
    const q = query.toUpperCase();
    setVehicleColorSuggestions(allVehicleColors.filter(c => c.includes(q)).slice(0, 8));
  }, [allVehicleColors]);

  const filterCompanies = useCallback((query: string) => {
    if (!query) {
      setCompanySuggestions(allCompanies.slice(0, 8));
      return;
    }
    const q = query.toUpperCase();
    setCompanySuggestions(allCompanies.filter(company => company.includes(q)).slice(0, 8));
  }, [allCompanies]);

  return {
    vehicleModelSuggestions,
    vehicleColorSuggestions,
    companySuggestions,
    filterVehicleModels,
    filterVehicleColors,
    filterCompanies,
  };
}
