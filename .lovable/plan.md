

## Problema Identificado

O morador **não consegue consultar a tabela `user_roles`** para descobrir quais são os usuários da portaria (admin, receptionist, security_guard). A política RLS da tabela `user_roles` só permite que cada usuário veja **seu próprio papel**. Como o morador tem papel `resident`, a query retorna vazia e nenhuma notificação é inserida.

Esse mesmo problema afeta tanto a autorização individual quanto a lista de convidados.

## Solução

Criar uma **função de banco de dados com SECURITY DEFINER** que insere notificações para todo o staff, contornando as restrições de RLS — o mesmo padrão já utilizado no trigger `notify_staff_on_resident_message` para o chat.

### Etapas

1. **Criar função SQL `notify_all_staff`** — Uma função `SECURITY DEFINER` que recebe `title`, `body`, `type` e `related_id`, e insere uma notificação na tabela `notifications` para cada usuário com papel de staff.

2. **Atualizar `ResidentAuthorizations.tsx`** — Substituir o bloco que faz `select` em `user_roles` + `insert` em `notifications` por uma chamada `supabase.rpc('notify_all_staff', { ... })` em ambos os fluxos (autorização individual e lista de convidados).

### Detalhes Técnicos

**Migração SQL:**
```sql
CREATE OR REPLACE FUNCTION public.notify_all_staff(
  _title text,
  _body text,
  _type text,
  _related_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notifications (user_id, title, body, type, related_id)
  SELECT ur.user_id, _title, _body, _type, _related_id
  FROM public.user_roles ur
  WHERE ur.role IN ('admin', 'receptionist', 'security_guard');
END;
$$;
```

**No frontend** (ambos os locais em `ResidentAuthorizations.tsx`):
```typescript
// Substituir o bloco staffRoles + notifications.insert por:
await supabase.rpc('notify_all_staff', {
  _title: 'Nova autorização de visitante',
  _body: `Morador autorizou a entrada de ${form.visitor_name}`,
  _type: 'authorization',
});
```

