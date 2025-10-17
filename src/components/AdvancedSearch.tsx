import { useState } from 'react';
import { Search, Filter, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface AdvancedSearchProps {
  onSearch: (filters: SearchFilters) => void;
  placeholder?: string;
  showTypeFilter?: boolean;
  showStatusFilter?: boolean;
  showDateFilter?: boolean;
}

export interface SearchFilters {
  searchTerm: string;
  type?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
}

export function AdvancedSearch({
  onSearch,
  placeholder = "Buscar...",
  showTypeFilter = false,
  showStatusFilter = false,
  showDateFilter = false,
}: AdvancedSearchProps) {
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<SearchFilters>({
    searchTerm: '',
    type: '',
    status: '',
    dateFrom: '',
    dateTo: '',
  });

  const handleSearchChange = (value: string) => {
    const newFilters = { ...filters, searchTerm: value };
    setFilters(newFilters);
    onSearch(newFilters);
  };

  const handleFilterChange = (key: keyof SearchFilters, value: string) => {
    const newFilters = { ...filters, [key]: value };
    setFilters(newFilters);
    onSearch(newFilters);
  };

  const clearFilters = () => {
    const clearedFilters = {
      searchTerm: '',
      type: '',
      status: '',
      dateFrom: '',
      dateTo: '',
    };
    setFilters(clearedFilters);
    onSearch(clearedFilters);
  };

  const hasActiveFilters = filters.type || filters.status || filters.dateFrom || filters.dateTo;

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder={placeholder}
            value={filters.searchTerm}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-10"
          />
        </div>
        <Button
          variant={showFilters ? "default" : "outline"}
          size="icon"
          onClick={() => setShowFilters(!showFilters)}
          className="relative"
        >
          <Filter className="h-4 w-4" />
          {hasActiveFilters && (
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-primary rounded-full" />
          )}
        </Button>
        {hasActiveFilters && (
          <Button variant="ghost" size="icon" onClick={clearFilters}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {showFilters && (
        <Card>
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {showTypeFilter && (
                <div>
                  <label className="text-sm font-medium mb-2 block">Tipo</label>
                  <Select
                    value={filters.type}
                    onValueChange={(value) => handleFilterChange('type', value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Todos" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Todos</SelectItem>
                      <SelectItem value="visitor">Visitante</SelectItem>
                      <SelectItem value="service_provider">Prestador de Serviço</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {showStatusFilter && (
                <div>
                  <label className="text-sm font-medium mb-2 block">Status</label>
                  <Select
                    value={filters.status}
                    onValueChange={(value) => handleFilterChange('status', value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Todos" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Todos</SelectItem>
                      <SelectItem value="pending">Pendente</SelectItem>
                      <SelectItem value="delivered">Entregue</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {showDateFilter && (
                <>
                  <div>
                    <label className="text-sm font-medium mb-2 block">Data Início</label>
                    <Input
                      type="date"
                      value={filters.dateFrom}
                      onChange={(e) => handleFilterChange('dateFrom', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-2 block">Data Fim</label>
                    <Input
                      type="date"
                      value={filters.dateTo}
                      onChange={(e) => handleFilterChange('dateTo', e.target.value)}
                    />
                  </div>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
