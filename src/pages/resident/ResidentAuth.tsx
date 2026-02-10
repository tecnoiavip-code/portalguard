import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { Home, Loader2 } from 'lucide-react';

const ResidentAuth = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        toast.error(error.message.includes('Invalid login') ? 'Email ou senha incorretos' : error.message);
        return;
      }

      // Check if user is a resident
      const { data: role } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', data.user.id)
        .eq('role', 'resident')
        .maybeSingle();

      if (!role) {
        await supabase.auth.signOut();
        toast.error('Esta conta não é de morador. Use o portal da portaria.');
        return;
      }

      toast.success('Login realizado!');
      navigate('/morador');
    } catch {
      toast.error('Erro ao fazer login');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast.error('As senhas não conferem');
      return;
    }
    if (password.length < 6) {
      toast.error('Senha deve ter pelo menos 6 caracteres');
      return;
    }
    setIsLoading(true);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('register-resident', {
        body: { email, password },
      });

      if (fnError) {
        toast.error('Erro ao criar conta. Tente novamente.');
        return;
      }

      if (data?.error) {
        toast.error(data.error);
        return;
      }

      toast.success('Conta criada com sucesso! Faça login.');
      setMode('login');
    } catch {
      toast.error('Erro ao criar conta');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-accent/5 via-background to-primary/5 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 bg-accent/10 rounded-full flex items-center justify-center">
              <Home className="w-8 h-8 text-accent" />
            </div>
          </div>
          <CardTitle className="text-2xl">Portal do Morador</CardTitle>
          <CardDescription>Acesse sua área exclusiva</CardDescription>
        </CardHeader>
        <CardContent>
          {mode === 'login' ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email cadastrado</Label>
                <Input id="email" type="email" placeholder="seu@email.com" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={isLoading} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Senha</Label>
                <Input id="password" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required disabled={isLoading} />
              </div>
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Entrando...</> : 'Entrar'}
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                Primeira vez?{' '}
                <button type="button" onClick={() => setMode('register')} className="text-accent hover:underline font-medium">Criar conta</button>
              </p>
            </form>
          ) : (
            <form onSubmit={handleRegister} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="reg-email">Email cadastrado na portaria</Label>
                <Input id="reg-email" type="email" placeholder="seu@email.com" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={isLoading} />
                <p className="text-xs text-muted-foreground">Use o mesmo email do seu cadastro de morador</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="reg-password">Criar senha</Label>
                <Input id="reg-password" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} disabled={isLoading} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reg-confirm">Confirmar senha</Label>
                <Input id="reg-confirm" type="password" placeholder="••••••••" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={6} disabled={isLoading} />
              </div>
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Criando...</> : 'Criar Conta'}
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                Já tem conta?{' '}
                <button type="button" onClick={() => setMode('login')} className="text-accent hover:underline font-medium">Fazer login</button>
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ResidentAuth;
