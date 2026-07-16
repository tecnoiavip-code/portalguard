import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldCheck } from "lucide-react";

type AuthorizationDetails = {
  client?: { name?: string; client_uri?: string };
  scope?: string;
  redirect_uri?: string;
  redirect_url?: string;
  redirect_to?: string;
};

// Beta namespace — keep a small typed wrapper instead of relying on generated types.
const oauth = (supabase.auth as any).oauth as {
  getAuthorizationDetails: (id: string) => Promise<{ data: AuthorizationDetails | null; error: any }>;
  approveAuthorization: (id: string) => Promise<{ data: AuthorizationDetails | null; error: any }>;
  denyAuthorization: (id: string) => Promise<{ data: AuthorizationDetails | null; error: any }>;
};

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<AuthorizationDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!authorizationId) {
        setError("Requisição de autorização inválida (authorization_id ausente).");
        return;
      }
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        const next = window.location.pathname + window.location.search;
        window.location.href = "/auth?next=" + encodeURIComponent(next);
        return;
      }
      if (!oauth) {
        setError("OAuth server not enabled on this backend.");
        return;
      }
      const { data, error: err } = await oauth.getAuthorizationDetails(authorizationId);
      if (!active) return;
      if (err) {
        setError(err.message ?? "Falha ao carregar a autorização.");
        return;
      }
      const immediate = data?.redirect_url ?? data?.redirect_to;
      if (immediate && !data?.client) {
        window.location.href = immediate;
        return;
      }
      setDetails(data);
    })();
    return () => {
      active = false;
    };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    setBusy(true);
    const { data, error: err } = approve
      ? await oauth.approveAuthorization(authorizationId)
      : await oauth.denyAuthorization(authorizationId);
    if (err) {
      setBusy(false);
      setError(err.message ?? "Falha ao registrar a decisão.");
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("O servidor de autorização não retornou uma URL de redirecionamento.");
      return;
    }
    window.location.href = target;
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Não foi possível carregar a autorização</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (!details) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  const clientName = details.client?.name ?? "um aplicativo externo";

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 via-background to-secondary/5 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-3">
            <ShieldCheck className="w-10 h-10 text-primary" />
          </div>
          <CardTitle>Conectar {clientName} ao PortalGuard</CardTitle>
          <CardDescription>
            Isso permite que {clientName} use as ferramentas do PortalGuard como você. As permissões do
            aplicativo e as políticas do backend continuam valendo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-sm text-muted-foreground">
            Escopo solicitado: <span className="font-mono">{details.scope || "openid email profile"}</span>
          </div>
          <div className="flex gap-2 pt-2">
            <Button className="flex-1" disabled={busy} onClick={() => decide(true)}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Aprovar"}
            </Button>
            <Button className="flex-1" variant="outline" disabled={busy} onClick={() => decide(false)}>
              Cancelar
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
