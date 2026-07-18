import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('==================================================');
console.log('   Iniciando PortalGuard com Banco Local (PC)     ');
console.log('==================================================\n');

// 1. Verificar se o Docker está rodando
console.log('Verificando se o Docker Desktop está em execução...');
try {
  execSync('docker info', { stdio: 'ignore' });
  console.log('\x1b[32m[OK] Docker está rodando.\x1b[0m\n');
} catch (e) {
  console.error('\x1b[31m[ERRO] O Docker não está rodando ou não está instalado!\x1b[0m');
  console.error('O Supabase Local depende do Docker Desktop para executar o PostgreSQL e outros serviços.');
  console.error('Por favor:');
  console.error('1. Inicie o Docker Desktop em seu computador.');
  console.error('2. Se não tiver o Docker instalado, baixe em: https://www.docker.com/products/docker-desktop/');
  console.error('3. Tente rodar este comando novamente após o Docker estar ativo.\n');
  process.exit(1);
}

// 2. Verificar status do Supabase local e iniciá-lo se necessário
console.log('Verificando status do Supabase local...');
let statusOutput = '';
let isRunning = false;
try {
  statusOutput = execSync('npx supabase status', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
  if (statusOutput.includes('API URL') || statusOutput.includes('api-url')) {
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
let studioUrl = '';

// Tentar fazer o parse como JSON primeiro
const jsonStart = statusOutput.indexOf('{');
const jsonEnd = statusOutput.lastIndexOf('}');
if (jsonStart !== -1 && jsonEnd !== -1) {
  const jsonString = statusOutput.slice(jsonStart, jsonEnd + 1);
  try {
    const credentials = JSON.parse(jsonString);
    apiUrl = credentials.API_URL || credentials.api_url;
    anonKey = credentials.ANON_KEY || credentials.anon_key;
    studioUrl = credentials.STUDIO_URL || credentials.studio_url;
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
                statusOutput.match(/anon key:\s*([^\s]+)/i) ||
                statusOutput.match(/anon-key:\s*([^\s]+)/i);
  if (match) anonKey = match[1].trim();
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

// 5. Mostrar links e iniciar o servidor web
console.log('==================================================');
console.log('\x1b[36m🚀 BANCO DE DADOS LOCAL PRONTO PARA USO!\x1b[0m');
console.log(`- API do Supabase Local: ${apiUrl}`);
console.log(`- Dashboard do Banco (Studio): \x1b[34m\x1b[4m${studioUrl}\x1b[0m`);
console.log('  (Abra o link acima no navegador para visualizar e gerenciar seu banco local)');
console.log('==================================================\n');

console.log('Iniciando o servidor da portaria...');
const child = spawn('npm', ['run', 'dev'], { stdio: 'inherit', shell: true });

child.on('exit', (code) => {
  console.log(`\nServidor encerrado (código: ${code}).`);
  console.log('\n\x1b[33mDica: Para desligar o banco de dados e liberar memória do seu PC, execute: npx supabase stop\x1b[0m');
  process.exit(code || 0);
});
