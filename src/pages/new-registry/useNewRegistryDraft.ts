import { Dispatch, SetStateAction, useEffect } from 'react';
import {
  EMPTY_NEW_REGISTRY_FORM,
  NEW_REGISTRY_DRAFT_KEY,
  NewRegistryFormData,
  hasRegistryFormContent,
} from './registry-form';

interface UseNewRegistryDraftParams {
  isDialogOpen: boolean;
  editingId: string;
  visitedLocationSearch: string;
  formData: NewRegistryFormData;
  setIsDialogOpen: Dispatch<SetStateAction<boolean>>;
  setEditingId: Dispatch<SetStateAction<string>>;
  setVisitedLocationSearch: Dispatch<SetStateAction<string>>;
  setFormData: Dispatch<SetStateAction<NewRegistryFormData>>;
}

export function useNewRegistryDraft({
  isDialogOpen,
  editingId,
  visitedLocationSearch,
  formData,
  setIsDialogOpen,
  setEditingId,
  setVisitedLocationSearch,
  setFormData,
}: UseNewRegistryDraftParams) {
  const clearRegistryDraft = () => {
    try {
      localStorage.removeItem(NEW_REGISTRY_DRAFT_KEY);
    } catch {
      // ignore storage errors
    }
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem(NEW_REGISTRY_DRAFT_KEY);
      if (!raw) return;

      const draft = JSON.parse(raw) as {
        isOpen?: boolean;
        editingId?: string;
        visitedLocationSearch?: string;
        formData?: Partial<NewRegistryFormData>;
      };
      const mergedForm = {
        ...EMPTY_NEW_REGISTRY_FORM,
        ...(draft.formData || {}),
      };
      const savedVisited = draft.visitedLocationSearch || '';
      if (!draft?.isOpen && !hasRegistryFormContent(mergedForm, savedVisited)) return;

      setEditingId(draft.editingId || '');
      setVisitedLocationSearch(savedVisited);
      setFormData(mergedForm);
      setIsDialogOpen(true);
    } catch {
      // ignore invalid drafts
    }
  }, [setEditingId, setFormData, setIsDialogOpen, setVisitedLocationSearch]);

  useEffect(() => {
    if (!isDialogOpen && !hasRegistryFormContent(formData, visitedLocationSearch)) return;
    try {
      localStorage.setItem(
        NEW_REGISTRY_DRAFT_KEY,
        JSON.stringify({
          isOpen: isDialogOpen,
          editingId,
          visitedLocationSearch,
          formData,
        })
      );
    } catch {
      // ignore storage errors
    }
  }, [isDialogOpen, editingId, visitedLocationSearch, formData]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDialogOpen && !hasRegistryFormContent(formData, visitedLocationSearch)) return;
      event.preventDefault();
      event.returnValue = '';
    };

    const persistDraftNow = () => {
      if (!isDialogOpen && !hasRegistryFormContent(formData, visitedLocationSearch)) return;
      try {
        localStorage.setItem(
          NEW_REGISTRY_DRAFT_KEY,
          JSON.stringify({
            isOpen: isDialogOpen,
            editingId,
            visitedLocationSearch,
            formData,
          })
        );
      } catch {
        // ignore storage errors
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', persistDraftNow);
    document.addEventListener('visibilitychange', persistDraftNow);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', persistDraftNow);
      document.removeEventListener('visibilitychange', persistDraftNow);
    };
  }, [isDialogOpen, editingId, visitedLocationSearch, formData]);

  return { clearRegistryDraft };
}
