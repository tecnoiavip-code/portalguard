import { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { translateAuthError } from '@/lib/translate-auth-error';
import appLogo from '@/assets/app-icon-v18-preview.png';

export const Auth = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [isSendingReset, setIsSendingReset] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const auth = supabase.auth as any;

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupFullName, setSignupFullName] = useState('');

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSendingReset(true);
    try {
      const { error } = await auth.resetPasswordForEmail(resetEmail, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) {
        toast.error(translateAuthError(error.message));
        return;
      }
      toast.success('Email de recuperação enviado! Verifique sua caixa de entrada.');
      setShowForgotPassword(false);
      setResetEmail('');
    } catch {
      toast.error('Erro ao enviar email de recuperação');
    } finally {
      setIsSendingReset(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const { error } = await signIn(loginEmail, loginPassword);
      
      if (error) {
        toast.error(translateAuthError(error.message));
        return;
      }

      const { data: { user } } = await auth.getUser();
      if (user) {
        const { data: residentRole } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', user.id)
          .eq('role', 'resident')
          .maybeSingle();

        if (residentRole) {
          toast.success('Login realizado! Redirecionando para o Portal do Morador.');
          navigate('/morador');
          return;
        }
      }

      toast.success('Login realizado com sucesso!');
      navigate('/');
    } catch {
      toast.error('Erro ao fazer login');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      if (signupPassword.length < 6) {
        toast.error('A senha deve ter pelo menos 6 caracteres');
        return;
      }

      const { error } = await signUp(signupEmail, signupPassword, signupFullName);
      
      if (error) {
        toast.error(translateAuthError(error.message));
        return;
      }

      toast.success('Conta criada com sucesso! Você já pode fazer login.');
      // Switch to login tab
      document.querySelector<HTMLButtonElement>('[value="login"]')?.click();
    } catch (error) {
      toast.error('Erro ao criar conta');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
    <Helmet>
      <title>Acesso da equipe — PortalGuard Pro</title>
      <meta name="description" content="Entre na conta da equipe do PortalGuard Pro para gerenciar moradores, visitantes e correspondências do condomínio." />
      <link rel="canonical" href="https://portalguard.lovable.app/auth" />
      <meta property="og:title" content="Acesso da equipe — PortalGuard Pro" />
      <meta property="og:description" content="Login da equipe do condomínio no PortalGuard Pro." />
      <meta property="og:url" content="https://portalguard.lovable.app/auth" />
      <meta name="robots" content="noindex,nofollow" />
    </Helmet>
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 via-background to-secondary/5 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <img src={appLogo} alt="PortalGuard Pro" className="w-16 h-16 rounded-2xl shadow-lg" />
          </div>
          <CardTitle className="text-2xl">PortalGuard Pro</CardTitle>
          <CardDescription>Sistema de controle de acesso seguro</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="login" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">Entrar</TabsTrigger>
              <TabsTrigger value="signup">Cadastrar</TabsTrigger>
            </TabsList>
            
            <TabsContent value="login">
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="login-email">Email</Label>
                  <Input
                    id="login-email"
                    type="email"
                    placeholder="seu@email.com"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    required
                    disabled={isLoading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="login-password">Senha</Label>
                  <Input
                    id="login-password"
                    type="password"
                    placeholder="••••••••"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    required
                    disabled={isLoading}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Entrando...</> : 'Entrar'}
                </Button>
                <div className="text-center">
                  <button
                    type="button"
                    onClick={() => { setResetEmail(loginEmail); setShowForgotPassword(true); }}
                    className="text-sm text-muted-foreground hover:text-primary hover:underline"
                  >
                    Esqueci minha senha
                  </button>
                </div>
              </form>
            </TabsContent>
            
            <TabsContent value="signup">
              <form onSubmit={handleSignup} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signup-name">Nome Completo</Label>
                  <Input
                    id="signup-name"
                    type="text"
                    placeholder="Seu nome completo"
                    value={signupFullName}
                    onChange={(e) => setSignupFullName(e.target.value)}
                    required
                    disabled={isLoading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-email">Email</Label>
                  <Input
                    id="signup-email"
                    type="email"
                    placeholder="seu@email.com"
                    value={signupEmail}
                    onChange={(e) => setSignupEmail(e.target.value)}
                    required
                    disabled={isLoading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-password">Senha</Label>
                  <Input
                    id="signup-password"
                    type="password"
                    placeholder="••••••••"
                    value={signupPassword}
                    onChange={(e) => setSignupPassword(e.target.value)}
                    required
                    minLength={6}
                    disabled={isLoading}
                  />
                  <p className="text-xs text-muted-foreground">Mínimo de 6 caracteres</p>
                </div>
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? 'Criando conta...' : 'Criar Conta'}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Forgot Password Modal */}
      {showForgotPassword && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowForgotPassword(false)}>
          <Card className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <CardHeader>
              <CardTitle>Recuperar Senha</CardTitle>
              <CardDescription>Informe seu email para receber o link de recuperação</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleForgotPassword} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="reset-email">Email</Label>
                  <Input
                    id="reset-email"
                    type="email"
                    placeholder="seu@email.com"
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    required
                    disabled={isSendingReset}
                  />
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" className="flex-1" onClick={() => setShowForgotPassword(false)}>
                    Cancelar
                  </Button>
                  <Button type="submit" className="flex-1" disabled={isSendingReset}>
                    {isSendingReset ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Enviando...</> : 'Enviar Link'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
    </>
  );
};

export default Auth;
