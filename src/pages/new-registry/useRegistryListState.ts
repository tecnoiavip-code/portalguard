import { useEffect, useMemo, useState } from 'react';

import { AccessEntry } from '@/types';

const ITEMS_PER_PAGE = 12;

const matchesSearch = (entry: AccessEntry, searchTerm: string) => {
  const normalizedSearch = searchTerm.toLowerCase();
  return (
    entry.visitorName.toLowerCase().includes(normalizedSearch) ||
    entry.apartment.toLowerCase().includes(normalizedSearch) ||
    entry.visitorDocument.toLowerCase().includes(normalizedSearch)
  );
};

export const useRegistryListState = (allEntries: AccessEntry[]) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  const activeEntries = useMemo(
    () => allEntries.filter(entry => !entry.exitTime),
    [allEntries]
  );

  const filteredActiveEntries = useMemo(
    () => activeEntries.filter(entry => matchesSearch(entry, searchTerm)),
    [activeEntries, searchTerm]
  );

  const filteredAllEntries = useMemo(
    () => allEntries.filter(entry => matchesSearch(entry, searchTerm)),
    [allEntries, searchTerm]
  );

  const totalPages = Math.ceil(filteredActiveEntries.length / ITEMS_PER_PAGE);
  const safePage = Math.max(1, Math.min(currentPage, totalPages || 1));

  const paginatedEntries = useMemo(
    () => filteredActiveEntries.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE),
    [filteredActiveEntries, safePage]
  );

  useEffect(() => {
    if (totalPages > 0 && currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
    setCurrentPage(1);
  };

  return {
    activeEntries,
    filteredActiveEntries,
    filteredAllEntries,
    paginatedEntries,
    searchTerm,
    currentPage: safePage,
    totalPages,
    setCurrentPage,
    handleSearchChange,
  };
};
