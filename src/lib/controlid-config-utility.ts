// Generates a standalone HTML utility that runs on the gatehouse PC (same LAN
// as the Control iD devices) and writes the Push Server config to flash.
// Always points to the current production backend (config/supabase.json).
import supabaseConfig from '../../config/supabase.json';

export const WEBHOOK_HOST = new URL(supabaseConfig.url).hostname;
export const WEBHOOK_URL = `https://${WEBHOOK_HOST}/functions/v1/controlid-webhook`;

export function buildControlIdUtilityHtml(ips: string[]): string {
  const config = {
    push_server: {
      push_remote_address: WEBHOOK_URL,
      push_request_timeout: '15000',
      push_request_period: '5',
    },
    monitor: {
      request_timeout: '15000',
      hostname: WEBHOOK_HOST,
      port: '443',
      path: '/functions/v1/controlid-webhook',
    },
    general: { online: '1', local_identification: '1' },
  };
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Configurador Control iD - CondoGuard</title>
<style>body{font-family:system-ui;background:#111418;color:#e7e9ec;max-width:760px;margin:30px auto;padding:0 16px}
input,textarea{width:100%;padding:8px;background:#1c2026;color:#fff;border:1px solid #333;border-radius:6px;box-sizing:border-box}
button{padding:10px 16px;border:0;border-radius:6px;background:#2f7d4f;color:#fff;font-weight:600;cursor:pointer;margin-top:12px}
pre{background:#000;padding:12px;border-radius:6px;white-space:pre-wrap;font-size:12px;max-height:340px;overflow:auto}label{display:block;margin-top:12px;font-size:13px}</style></head>
<body><h2>Configurador Control iD — Liberação Centralizada</h2>
<p>Abra este arquivo no PC da portaria (mesma rede dos equipamentos). Ele grava o Servidor Push, o Monitor e ativa o modo online (Pro) apontando para:<br><b>${WEBHOOK_URL}</b></p>
<label>IPs dos equipamentos (um por linha)</label><textarea id="ips" rows="4">${ips.join('\n')}</textarea>
<label>Usuário</label><input id="u" value="admin"><label>Senha</label><input id="p" type="password" value="admin">
<label><input type="checkbox" id="rb" checked style="width:auto"> Reiniciar após gravar</label>
<button onclick="run()">Aplicar configuração</button><pre id="log"></pre>
<script>
const CONFIG=${JSON.stringify(config)};
const ONLINE_SERVER_IP=${JSON.stringify(WEBHOOK_URL)};
const log=m=>{document.getElementById('log').textContent+=m+'\\n'};
async function post(ip,path,body){const r=await fetch('http://'+ip+'/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})});const t=await r.text();if(!r.ok)throw new Error(path+' HTTP '+r.status+' '+t);try{return JSON.parse(t)}catch{return {}}}
async function ensureOnlineServer(ip,s){
const loaded=await post(ip,'load_objects.fcgi?session='+s,{object:'devices',fields:['id','name','ip']});
const list=(loaded&&loaded.devices)||[];
let sid=null;
if(list.length>0){sid=list[0].id;await post(ip,'create_or_modify_objects.fcgi?session='+s,{object:'devices',values:[{id:sid,name:'PortalGuard',ip:ONLINE_SERVER_IP}]});log('['+ip+'] servidor online atualizado (id '+sid+')')}
else{const c=await post(ip,'create_objects.fcgi?session='+s,{object:'devices',values:[{name:'PortalGuard',ip:ONLINE_SERVER_IP,public_key:''}]});sid=c.ids&&c.ids[0];log('['+ip+'] servidor online criado (id '+sid+')')}
if(!sid)throw new Error('não foi possível registrar o servidor online');
await post(ip,'set_configuration.fcgi?session='+s,{general:{online:'1',local_identification:'1',ihm_enterprise_mode:'0'},online_client:{server_id:String(sid),extract_template:'0',max_request_attempts:'3'}});
log('['+ip+'] modo online (Pro) ativado ✔')}
async function run(){document.getElementById('log').textContent='';
const ips=document.getElementById('ips').value.split(/\\s+/).filter(Boolean);
for(const ip of ips){try{log('['+ip+'] login...');
const s=(await post(ip,'login.fcgi',{login:document.getElementById('u').value,password:document.getElementById('p').value})).session;
if(!s)throw new Error('sessão não retornada (usuário/senha?)');
await post(ip,'set_configuration.fcgi?session='+s,CONFIG);log('['+ip+'] Servidor Push e Monitor gravados ✔');
try{await ensureOnlineServer(ip,s)}catch(e){log('['+ip+'] AVISO: modo online falhou: '+e.message)}
if(document.getElementById('rb').checked){try{await post(ip,'reboot.fcgi?session='+s)}catch(e){}log('['+ip+'] reiniciando...')}
}catch(e){log('['+ip+'] ERRO: '+e.message+' — confira IP, rede e se o modo iDCloud está desligado.')}}
log('Concluído.')}
</script></body></html>`;
}

export function downloadControlIdUtility(ips: string[]) {
  const blob = new Blob([buildControlIdUtilityHtml(ips)], { type: 'text/html;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'config-controlid.html';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
