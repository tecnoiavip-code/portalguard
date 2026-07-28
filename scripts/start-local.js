import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('==================================================');
console.log('   Iniciando PortalGuard com Banco Local (PC)     ');
console.log('==================================================\n');

// 1. Verificar se o Docker está rodando
console.log('Verificando se o Docker Desktop está em execução...');
let dockerRunning = false;
try {
  execSync('docker info', { stdio: 'ignore' });
  dockerRunning = true;
  console.log('\x1b[32m[OK] Docker está rodando.\x1b[0m\n');
} catch (e) {
  const dockerExePath = 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe';
  if (fs.existsSync(dockerExePath)) {
    console.log('\x1b[33m[INFO] Abrindo o Docker Desktop automaticamente...\x1b[0m');
    try {
      spawn(dockerExePath, [], { detached: true, stdio: 'ignore' }).unref();
      console.log('Aguardando a inicialização da engine do Docker (pode levar alguns segundos)...');
      
      for (let attempt = 1; attempt <= 30; attempt++) {
        try {
          execSync('docker info', { stdio: 'ignore' });
          dockerRunning = true;
          console.log('\n\x1b[32m[OK] Docker Desktop iniciado com sucesso!\x1b[0m\n');
          break;
        } catch (err) {
          process.stdout.write('.');
          execSync('powershell -Command "Start-Sleep -Seconds 2"', { stdio: 'ignore' });
        }
      }
    } catch (err) {
      // Fallback
    }
  }

  if (!dockerRunning) {
    console.error('\n\x1b[31m[ERRO] O Docker não está rodando ou não pôde ser iniciado automaticamente!\x1b[0m');
    console.error('O Supabase Local depende do Docker Desktop para executar o PostgreSQL e outros serviços.');
    console.error('Por favor:');
    console.error('1. Abra o Docker Desktop manualmente no seu computador.');
    console.error('2. Aguarde o Docker carregar totalmente.');
    console.error('3. Execute o atalho novamente após o Docker estar ativo.\n');
    process.exit(1);
  }
}

// 2. Verificar status do Supabase local e iniciá-lo se necessário
console.log('Verificando status do Supabase local...');
let statusOutput = '';
let isRunning = false;
try {
  statusOutput = execSync('npx supabase status', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
  if (statusOutput.includes('API_URL') || statusOutput.includes('API URL') || statusOutput.includes('api-url') || statusOutput.includes('127.0.0.1:54321')) {
    isRunning = true;
  }
} catch (e) {
  // Indica que não está rodando
}

if (!isRunning) {
  try {
    console.log('Parando containers antigos para garantir um estado limpo...');
    try {
      execSync('npx supabase stop', { stdio: 'ignore' });
    } catch (e) {
      // Ignora se já estava parado
    }
    console.log('Iniciando o Supabase local (ignorando health checks para evitar timeouts no Windows)...');
    execSync('npx supabase start --ignore-health-check', { stdio: 'inherit' });
    statusOutput = execSync('npx supabase status', { encoding: 'utf8' });
  } catch (e) {
    console.error('\x1b[31m[ERRO] Falha ao iniciar o Supabase local.\x1b[0m');
    console.error(e.message);
    process.exit(1);
  }
} else {
  console.log('\x1b[32m[INFO] Containers do Supabase local já estão ativos.\x1b[0m\n');
}

// 3. Extrair as chaves e URLs locais
let apiUrl = '';
let anonKey = '';
let serviceKey = '';
let studioUrl = '';

// Tentar fazer o parse como JSON primeiro
const jsonStart = statusOutput.indexOf('{');
const jsonEnd = statusOutput.lastIndexOf('}');
if (jsonStart !== -1 && jsonEnd !== -1) {
  const jsonString = statusOutput.slice(jsonStart, jsonEnd + 1);
  try {
    const credentials = JSON.parse(jsonString);
    apiUrl = credentials.API_URL || credentials.api_url;
    anonKey = credentials.ANON_KEY || credentials.anon_key || credentials.PUBLISHABLE_KEY || credentials.publishable_key;
    serviceKey = credentials.SERVICE_ROLE_KEY || credentials.service_role_key;
    studioUrl = credentials.STUDIO_URL || credentials.studio_url || 'http://127.0.0.1:54323';
  } catch (e) {
    // Ignora erro e tenta via regex
  }
}

// Fallbacks de regex caso o JSON falhe ou as chaves mudem de formato
if (!apiUrl) {
  const match = statusOutput.match(/"?API_URL"?:\s*"([^"]+)"/i) || 
                statusOutput.match(/API URL:\s*(https?:\/\/[^\s]+)/i) ||
                statusOutput.match(/api-url:\s*(https?:\/\/[^\s]+)/i);
  if (match) apiUrl = match[1].trim();
}
if (!anonKey) {
  const match = statusOutput.match(/"?ANON_KEY"?:\s*"([^"]+)"/i) ||
                statusOutput.match(/"?PUBLISHABLE_KEY"?:\s*"([^"]+)"/i) ||
                statusOutput.match(/anon key:\s*([^\s]+)/i) ||
                statusOutput.match(/anon-key:\s*([^\s]+)/i);
  if (match) anonKey = match[1].trim();
}
if (!serviceKey) {
  const match = statusOutput.match(/"?SERVICE_ROLE_KEY"?:\s*"([^"]+)"/i) ||
                statusOutput.match(/service_role key:\s*([^\s]+)/i) ||
                statusOutput.match(/service-role-key:\s*([^\s]+)/i);
  if (match) serviceKey = match[1].trim();
}
if (!studioUrl) {
  const match = statusOutput.match(/"?STUDIO_URL"?:\s*"([^"]+)"/i) ||
                statusOutput.match(/Studio URL:\s*(https?:\/\/[^\s]+)/i) ||
                statusOutput.match(/studio-url:\s*(https?:\/\/[^\s]+)/i);
  if (match) studioUrl = match[1].trim();
}

if (!apiUrl || !anonKey) {
  console.error('\x1b[31m[ERRO] Não foi possível obter as credenciais do Supabase local.\x1b[0m');
  console.log('Saída do status:\n', statusOutput);
  process.exit(1);
}

// 4. Gravar arquivo .env.local
const envLocalPath = path.join(__dirname, '..', '.env.local');
let envContent = '';
if (fs.existsSync(envLocalPath)) {
  envContent = fs.readFileSync(envLocalPath, 'utf8');
}

const vars = {
  VITE_SUPABASE_URL: apiUrl,
  VITE_SUPABASE_PUBLISHABLE_KEY: anonKey,
  VITE_CONTROLID_INTEGRATION_ENABLED: 'true'
};

let linesArray = envContent.split('\n').filter(Boolean);
for (const [key, value] of Object.entries(vars)) {
  let found = false;
  linesArray = linesArray.map(line => {
    if (line.trim().startsWith(`${key}=`)) {
      found = true;
      return `${key}="${value}"`;
    }
    return line;
  });
  if (!found) {
    linesArray.push(`${key}="${value}"`);
  }
}

fs.writeFileSync(envLocalPath, linesArray.join('\n').trim() + '\n', 'utf8');
console.log('\x1b[32m[OK] Arquivo .env.local atualizado com as chaves locais do PC.\x1b[0m\n');

// 5. Provisionar usuário admin padrão (se necessário)
async function httpRequest(urlStr, options, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + (parsed.search || ''),
      method: options.method || 'GET',
      headers: options.headers || {},
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function provisionAdminUser(apiUrl, serviceKey) {
  const seedFilePath = path.join(__dirname, '..', '.env.local.seed');
  
  // Ler credenciais do arquivo seed se existir
  let adminEmail = 'admin@portalguard.local';
  let adminPassword = 'portaguard@2024';
  let adminName = 'Administrador';

  if (fs.existsSync(seedFilePath)) {
    const seedContent = fs.readFileSync(seedFilePath, 'utf8');
    const emailMatch = seedContent.match(/ADMIN_EMAIL=["']?([^"'\n\r]+)["']?/);
    const passMatch  = seedContent.match(/ADMIN_PASSWORD=["']?([^"'\n\r]+)["']?/);
    const nameMatch  = seedContent.match(/ADMIN_NAME=["']?([^"'\n\r]+)["']?/);
    if (emailMatch) adminEmail = emailMatch[1].trim();
    if (passMatch)  adminPassword = passMatch[1].trim();
    if (nameMatch)  adminName = nameMatch[1].trim();
  }

  if (!serviceKey) {
    console.log('\x1b[33m[AVISO] Chave de serviço não encontrada. Pulando provisionamento automático de admin.\x1b[0m');
    console.log('   → Para criar o admin manualmente, acesse o Supabase Studio e cadastre um usuário.\n');
    return;
  }

  const authUrl = apiUrl.replace(/\/$/, '');
  
  // Verificar se já existe algum usuário admin via listagem
  try {
    const listResp = await httpRequest(
      `${authUrl}/auth/v1/admin/users?page=1&per_page=50`,
      {
        method: 'GET',
        headers: {
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
        }
      }
    );

    const users = listResp.body?.users || [];
    const existingAdmin = users.find(u => u.email === adminEmail);
    
    if (existingAdmin) {
      // Usuário já existe - garantir que tem role admin
      await ensureAdminRole(authUrl, serviceKey, existingAdmin.id, adminEmail, adminName);
      return;
    }
  } catch (e) {
    // Ignorar erros na listagem
  }

  // Criar o usuário admin
  console.log(`Criando usuário admin local: ${adminEmail}...`);
  try {
    const createResp = await httpRequest(
      `${authUrl}/auth/v1/admin/users`,
      {
        method: 'POST',
        headers: {
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
        }
      },
      {
        email: adminEmail,
        password: adminPassword,
        email_confirm: true,
        user_metadata: { full_name: adminName },
      }
    );

    if (createResp.status === 200 || createResp.status === 201) {
      const userId = createResp.body?.id;
      if (userId) {
        await ensureAdminRole(authUrl, serviceKey, userId, adminEmail, adminName);
        
        console.log('\x1b[32m╔══════════════════════════════════════════════════╗\x1b[0m');
        console.log('\x1b[32m║        USUÁRIO ADMIN LOCAL CRIADO!               ║\x1b[0m');
        console.log('\x1b[32m╠══════════════════════════════════════════════════╣\x1b[0m');
        console.log(`\x1b[32m║  Email:  \x1b[1m${adminEmail.padEnd(40)}\x1b[22m\x1b[32m║\x1b[0m`);
        console.log(`\x1b[32m║  Senha:  \x1b[1m${adminPassword.padEnd(40)}\x1b[22m\x1b[32m║\x1b[0m`);
        console.log('\x1b[32m╚══════════════════════════════════════════════════╝\x1b[0m');
        console.log('\x1b[33m  → Use estas credenciais para fazer login no app local.\x1b[0m');
        console.log('\x1b[33m  → Para personalizar, crie o arquivo: .env.local.seed\x1b[0m\n');
      }
    } else if (createResp.status === 422 || createResp.status === 400) {
      // Usuário pode já existir com outro estado
      console.log('\x1b[33m[INFO] Usuário admin pode já existir. Verifique o Supabase Studio.\x1b[0m\n');
    } else {
      console.log(`\x1b[33m[AVISO] Não foi possível criar o usuário admin (status ${createResp.status}). Tente criar manualmente no Studio.\x1b[0m\n`);
    }
  } catch (e) {
    console.log('\x1b[33m[AVISO] Erro ao criar usuário admin. O banco pode estar ainda inicializando.\x1b[0m\n');
  }
}

async function ensureAdminRole(authUrl, serviceKey, userId, email, fullName) {
  try {
    // Usar SQL direto via PostgREST com service_role para inserir o role
    const roleResp = await httpRequest(
      `${authUrl}/rest/v1/user_roles`,
      {
        method: 'POST',
        headers: {
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=ignore-duplicates',
        }
      },
      {
        user_id: userId,
        role: 'admin',
      }
    );

    if (roleResp.status === 200 || roleResp.status === 201) {
      console.log(`\x1b[32m[OK] Role "admin" confirmado para: ${email}\x1b[0m`);
    }

    // Garantir que o perfil existe
    await httpRequest(
      `${authUrl}/rest/v1/profiles`,
      {
        method: 'POST',
        headers: {
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=ignore-duplicates',
        }
      },
      {
        id: userId,
        full_name: fullName,
      }
    );
  } catch (e) {
    // Ignorar erros de role (pode já existir)
  }
}

// Executar provisionamento e então iniciar o servidor
(async () => {
  await provisionAdminUser(apiUrl, serviceKey);

  // 6. Mostrar links e abrir o navegador automaticamente
  console.log('==================================================');
  console.log('\x1b[36m🚀 BANCO DE DADOS LOCAL PRONTO PARA USO!\x1b[0m');
  console.log(`- App PortalGuard: \x1b[32m\x1b[4mhttp://127.0.0.1:8080\x1b[0m`);
  console.log(`- API do Supabase Local: ${apiUrl}`);
  console.log(`- Dashboard do Banco (Studio): \x1b[34m\x1b[4m${studioUrl || 'http://127.0.0.1:54323'}\x1b[0m`);
  console.log('==================================================\n');

  // Abrir navegador automaticamente em 2.5 segundos
  setTimeout(() => {
    try {
      const url = 'http://127.0.0.1:8080';
      console.log(`\x1b[32m[OK] Abrindo ${url} no navegador...\x1b[0m\n`);
      execSync(`start "" "${url}"`, { stdio: 'ignore' });
    } catch (err) {
      // Ignorar falha se não conseguir abrir o navegador automaticamente
    }
  }, 2500);

  console.log('Iniciando o servidor web da portaria...');
  const child = spawn('npm', ['run', 'dev'], { stdio: 'inherit', shell: true });

  child.on('exit', (code) => {
    console.log(`\nServidor encerrado (código: ${code}).`);
    console.log('\n\x1b[33mDica: Para desligar o banco de dados e liberar memória do seu PC, execute: npx supabase stop\x1b[0m');
    process.exit(code || 0);
  });
})();
