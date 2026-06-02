export type NewRegistryVisitorType = 'visitor' | 'service_provider';

export interface NewRegistryFormData {
  visitorName: string;
  visitorDocument: string;
  visitorType: NewRegistryVisitorType;
  residentId: string;
  purpose: string;
  company: string;
  vehiclePlate: string;
  vehicleModel: string;
  vehicleColor: string;
  photo: string;
  badgeNumber: string;
}

export interface BlockedVisitor {
  id: string;
  visitor_name: string;
  visitor_document: string;
  reason: string | null;
  blocked_at: string;
  is_active: boolean;
}

export const NEW_REGISTRY_DRAFT_KEY = 'new-registry-form-draft-v1';

export const VEHICLE_SUGGESTIONS_CACHE_KEY = `vehicle_suggestions_cache:${import.meta.env.VITE_SUPABASE_URL || 'local'}:v3`;

export const EMPTY_NEW_REGISTRY_FORM: NewRegistryFormData = {
  visitorName: '',
  visitorDocument: '',
  visitorType: 'visitor',
  residentId: '',
  purpose: '',
  company: '',
  vehiclePlate: '',
  vehicleModel: '',
  vehicleColor: '',
  photo: '',
  badgeNumber: '',
};

export const hasRegistryFormContent = (form: NewRegistryFormData, visited: string) =>
  Boolean(
    visited ||
    form.visitorName ||
    form.visitorDocument ||
    form.residentId ||
    form.purpose ||
    form.company ||
    form.vehiclePlate ||
    form.vehicleModel ||
    form.vehicleColor ||
    form.photo ||
    form.badgeNumber ||
    form.visitorType !== 'visitor'
  );
