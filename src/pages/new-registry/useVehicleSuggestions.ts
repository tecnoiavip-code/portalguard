import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { VEHICLE_SUGGESTIONS_CACHE_KEY } from './registry-form';

interface VehicleSuggestions {
  models: string[];
  colors: string[];
  companies: string[];
}

const SUGGESTION_QUERY_LIMIT = 200;
const VISIBLE_SUGGESTION_LIMIT = 8;
const SUGGESTIONS_CACHE_TTL_MS = 60 * 60 * 1000;

const normalizeVehicleSuggestions = (values: Array<string | null | undefined>) =>
  [...new Set(values.map(value => String(value ?? '').trim().toUpperCase()))]
    .filter((value): value is string => Boolean(value))
    .sort();

const applyVehicleSuggestions = (
  suggestions: VehicleSuggestions,
  setters: {
    setAllVehicleModels: (values: string[]) => void;
    setAllVehicleColors: (values: string[]) => void;
    setAllCompanies: (values: string[]) => void;
    setVehicleModelSuggestions: (values: string[]) => void;
    setVehicleColorSuggestions: (values: string[]) => void;
    setCompanySuggestions: (values: string[]) => void;
  }
) => {
  setters.setAllVehicleModels(suggestions.models);
  setters.setAllVehicleColors(suggestions.colors);
  setters.setAllCompanies(suggestions.companies);
  setters.setVehicleModelSuggestions(suggestions.models.slice(0, VISIBLE_SUGGESTION_LIMIT));
  setters.setVehicleColorSuggestions(suggestions.colors.slice(0, VISIBLE_SUGGESTION_LIMIT));
  setters.setCompanySuggestions(suggestions.companies.slice(0, VISIBLE_SUGGESTION_LIMIT));
};

export function useVehicleSuggestions() {
  const [vehicleModelSuggestions, setVehicleModelSuggestions] = useState<string[]>([]);
  const [vehicleColorSuggestions, setVehicleColorSuggestions] = useState<string[]>([]);
  const [companySuggestions, setCompanySuggestions] = useState<string[]>([]);
  const [allVehicleModels, setAllVehicleModels] = useState<string[]>([]);
  const [allVehicleColors, setAllVehicleColors] = useState<string[]>([]);
  const [allCompanies, setAllCompanies] = useState<string[]>([]);

  const loadVehicleSuggestions = useCallback(async (): Promise<VehicleSuggestions> => {
    const [entriesRes, residentsRes] = await Promise.all([
      supabase
        .from('access_entries')
        .select('vehicle_model, vehicle_color, company')
        .or('vehicle_model.not.is.null,vehicle_color.not.is.null,company.not.is.null')
        .order('entry_time', { ascending: false })
        .limit(SUGGESTION_QUERY_LIMIT),
      supabase
        .from('residents')
        .select('vehicle_model, vehicle_color')
        .or('vehicle_model.not.is.null,vehicle_color.not.is.null')
        .order('created_at', { ascending: false })
        .limit(SUGGESTION_QUERY_LIMIT),
    ]);

    if (entriesRes.error) console.error('Error loading access entry suggestions:', entriesRes.error);
    if (residentsRes.error) console.error('Error loading resident vehicle suggestions:', residentsRes.error);

    const models = normalizeVehicleSuggestions([
      ...(entriesRes.data || []).map(r => r.vehicle_model),
      ...(residentsRes.data || []).map(r => r.vehicle_model),
    ]);
    const colors = normalizeVehicleSuggestions([
      ...(entriesRes.data || []).map(r => r.vehicle_color),
      ...(residentsRes.data || []).map(r => r.vehicle_color),
    ]);
    const companies = normalizeVehicleSuggestions((entriesRes.data || []).map(r => r.company));

    applyVehicleSuggestions(
      { models, colors, companies },
      {
        setAllVehicleModels,
        setAllVehicleColors,
        setAllCompanies,
        setVehicleModelSuggestions,
        setVehicleColorSuggestions,
        setCompanySuggestions,
      }
    );

    return { models, colors, companies };
  }, []);

  const loadVehicleSuggestionsWithCache = useCallback(async () => {
    const now = Date.now();

    try {
      const cached = localStorage.getItem(VEHICLE_SUGGESTIONS_CACHE_KEY);
      if (cached) {
        const { data, timestamp } = JSON.parse(cached);
        if (now - timestamp < SUGGESTIONS_CACHE_TTL_MS) {
          applyVehicleSuggestions(
            {
              models: data.models || [],
              colors: data.colors || [],
              companies: data.companies || [],
            },
            {
              setAllVehicleModels,
              setAllVehicleColors,
              setAllCompanies,
              setVehicleModelSuggestions,
              setVehicleColorSuggestions,
              setCompanySuggestions,
            }
          );
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
      setVehicleModelSuggestions(allVehicleModels.slice(0, VISIBLE_SUGGESTION_LIMIT));
      return;
    }
    const q = query.toUpperCase();
    setVehicleModelSuggestions(allVehicleModels.filter(m => m.includes(q)).slice(0, VISIBLE_SUGGESTION_LIMIT));
  }, [allVehicleModels]);

  const filterVehicleColors = useCallback((query: string) => {
    if (!query) {
      setVehicleColorSuggestions(allVehicleColors.slice(0, VISIBLE_SUGGESTION_LIMIT));
      return;
    }
    const q = query.toUpperCase();
    setVehicleColorSuggestions(allVehicleColors.filter(c => c.includes(q)).slice(0, VISIBLE_SUGGESTION_LIMIT));
  }, [allVehicleColors]);

  const filterCompanies = useCallback((query: string) => {
    if (!query) {
      setCompanySuggestions(allCompanies.slice(0, VISIBLE_SUGGESTION_LIMIT));
      return;
    }
    const q = query.toUpperCase();
    setCompanySuggestions(allCompanies.filter(company => company.includes(q)).slice(0, VISIBLE_SUGGESTION_LIMIT));
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
