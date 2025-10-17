import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollText, Search, LogIn, LogOut } from 'lucide-react';
import { storage } from '@/lib/storage';
import { AccessEntry } from '@/types';

export const Logs = () => {
  const [entries, setEntries] = useState<AccessEntry[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    loadEntries();
  }, []);

  const loadEntries = () => {
    const allEntries = storage.getEntries().sort(
      (a, b) => new Date(b.entryTime).getTime() - new Date(a.entryTime).getTime()
    );
    setEntries(allEntries);
  };

  const filteredEntries = entries.filter(
    (entry) =>
      entry.visitorName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      entry.residentName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      entry.apartment.toLowerCase().includes(searchTerm.toLowerCase()) ||
      entry.visitorDocument.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h2 className="text-3xl font-bold text-foreground mb-2">Logs de Acesso</h2>
        <p className="text-muted-foreground">Histórico completo de entradas e saídas</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <ScrollText className="h-5 w-5 text-primary" />
              <span>Histórico de Acessos</span>
            </div>
            <Badge variant="secondary">{entries.length} registros</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-6">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por visitante, morador, apartamento ou documento..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          <div className="space-y-3 max-h-[600px] overflow-y-auto">
            {filteredEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                {searchTerm ? 'Nenhum registro encontrado' : 'Nenhum acesso registrado ainda'}
              </p>
            ) : (
              filteredEntries.map((entry) => (
                <div
                  key={entry.id}
                  className="p-4 bg-card rounded-lg border border-border hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="font-semibold text-foreground text-lg">
                        {entry.visitorName}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Doc: {entry.visitorDocument}
                      </p>
                    </div>
                    <Badge
                      variant={entry.exitTime ? 'secondary' : 'default'}
                      className={entry.exitTime ? '' : 'bg-success'}
                    >
                      {entry.exitTime ? 'Finalizado' : 'Ativo'}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-muted-foreground">
                        <span className="font-medium">Visitando:</span> {entry.residentName}
                      </p>
                      <p className="text-muted-foreground">
                        <span className="font-medium">Apartamento:</span> {entry.apartment}
                      </p>
                      {entry.vehiclePlate && (
                        <p className="text-muted-foreground">
                          <span className="font-medium">Veículo:</span> {entry.vehiclePlate}
                        </p>
                      )}
                      {entry.purpose && (
                        <p className="text-muted-foreground">
                          <span className="font-medium">Motivo:</span> {entry.purpose}
                        </p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center space-x-2 text-success">
                        <LogIn className="h-4 w-4" />
                        <div>
                          <p className="font-medium">Entrada</p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(entry.entryTime).toLocaleString('pt-BR')}
                          </p>
                        </div>
                      </div>
                      {entry.exitTime && (
                        <div className="flex items-center space-x-2 text-muted-foreground">
                          <LogOut className="h-4 w-4" />
                          <div>
                            <p className="font-medium">Saída</p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(entry.exitTime).toLocaleString('pt-BR')}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
