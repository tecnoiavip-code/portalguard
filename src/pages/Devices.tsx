import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Wifi, WifiOff, Camera, Tag, CreditCard, Pencil, Trash2, Plus, Settings2, Loader2, Network, Search } from 'lucide-react';
import { Device } from '@/types';
import { useDevices } from '@/hooks/useDevices';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

export const Devices = () => {
  const { devices, loading, saveDevice, deleteDevice, refresh } = useDevices();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string>('');
  const [pushingConfig, setPushingConfig] = useState<string | null>(null);
  const [localConfigLoading, setLocalConfigLoading] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    type: 'facial_recognition' as Device['type'],
    location: '',
    status: 'online' as Device['status'],
    ipAddress: '',
    serialNumber: '',
  });

  const handlePushConfig = async (device: Device) => {
    if (!device.serialNumber) {
      toast.error('Dispositivo sem número de série configurado');
      return;
    }

    setPushingConfig(device.id);
    try {
      const { data, error } = await supabase.functions.invoke('controlid-webhook/push-config', {
        method: 'POST',
        body: { device_id: device.serialNumber },
      });

      if (error) throw error;

      toast.success('Configuração do monitor enfileirada com sucesso! O dispositivo receberá na próxima consulta push.', {
        duration: 5000,
        description: `Hostname: ${data?.config?.monitor?.hostname || 'N/A'}`,
      });
    } catch (err: any) {
      console.error('Error pushing config:', err);
      toast.error('Erro ao enviar configuração', {
        description: err.message || 'Tente novamente',
      });
    } finally {
      setPushingConfig(null);
    }
  };

  const handleLocalConfig = async (device: Device) => {
    if (!device.ipAddress) {
      toast.error('Dispositivo sem IP configurado');
      return;
    }

    // Mixed Content: browsers block http:// requests from https:// pages.
    // Download an HTML file that the user opens locally (file:// protocol) to bypass restrictions.
    if (window.location.protocol === 'https:') {
      const ip = device.ipAddress;
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
      let hostname = '';
      try { hostname = new URL(supabaseUrl).hostname; } catch { hostname = 'kxdqffkkufgsizszchvw.supabase.co'; }
      
      const script = generateLocalConfigScript(ip, hostname);
      const blob = new Blob([script], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      
      // Download as file so user opens from file:// (no mixed content)
      const a = document.createElement('a');
      a.href = url;
      a.download = `config-${ip.replace(/\./g, '-')}.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      toast.info('Arquivo de configuração baixado!', {
        duration: 10000,
        description: `Abra o arquivo "config-${ip.replace(/\./g, '-')}.html" no navegador e clique em "Configurar". Isso contorna o bloqueio de Mixed Content.`,
      });
      return;
    }

    setLocalConfigLoading(device.id);
    const ip = device.ipAddress;
    const port = '80';
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
    let hostname = '';
    try {
      hostname = new URL(supabaseUrl).hostname;
    } catch {
      hostname = 'kxdqffkkufgsizszchvw.supabase.co';
    }

    await executeLocalConfig(ip, port, hostname);
    setLocalConfigLoading(null);
  };

  const generateLocalConfigScript = (ip: string, hostname: string) => {
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Config Local - Control iD</title>
<style>body{font-family:system-ui;max-width:600px;margin:40px auto;padding:20px}
.log{background:#f5f5f5;padding:12px;border-radius:8px;margin:12px 0;font-size:13px;white-space:pre-wrap;max-height:500px;overflow-y:auto}
.ok{color:green}.err{color:red}.info{color:#666}.warn{color:#b45309}
h2{margin:0 0 16px}button{padding:8px 16px;border-radius:6px;border:none;background:#3b82f6;color:white;cursor:pointer;font-size:14px}
button:hover{background:#2563eb}</style></head>
<body><h2>⚙️ Configuração Local - Control iD</h2>
<p>Dispositivo: <strong>${ip}</strong></p>
<p>Servidor: <strong>${hostname}</strong></p>
<div id="log" class="log"><span class="info">Clique em Configurar para iniciar...</span></div>
<button onclick="run()">Configurar</button>
<script>
const log = document.getElementById('log');
function addLog(msg, cls) { log.innerHTML += '\\n<span class="'+cls+'">'+msg+'</span>'; log.scrollTop = log.scrollHeight; }

const desiredHost = '${hostname}';
const webhookPath = '/functions/v1/controlid-webhook';
const fullServerUrl = 'https://' + desiredHost + webhookPath;

async function run() {
  log.innerHTML = '<span class="info">Iniciando...</span>';
  try {
    const apiBase = 'http://${ip}';
    const hdr = {'Content-Type':'application/json'};

    // Step 0: Login
    addLog('1. Fazendo login...', 'info');
    const lr = await fetch(apiBase + '/login.fcgi', {
      method:'POST', headers: hdr,
      body:JSON.stringify({login:'admin',password:'admin'})
    });
    if (!lr.ok) throw new Error('Login falhou: ' + lr.status);
    const ld = await lr.json();
    const s = ld.session;
    if (!s) throw new Error('Sessão não retornada');
    addLog('✓ Login OK (session: ' + s + ')', 'ok');

    // Step 1: Detect firmware
    addLog('2. Detectando firmware...', 'info');
    let fwVersion = 'unknown';
    try {
      const sysResp = await fetch(apiBase + '/system_information.fcgi?session=' + s, { method: 'POST', headers: hdr });
      if (sysResp.ok) {
        const sysData = await sysResp.json();
        fwVersion = sysData.firmware || sysData.version || 'unknown';
        addLog('✓ Firmware: ' + fwVersion, 'ok');
      }
    } catch(e) { addLog('⚠ Não foi possível detectar firmware', 'warn'); }

    const fwMajorMinor = fwVersion.match(/(\\d+)\\.(\\d+)/);
    const fwMajor = fwMajorMinor ? parseInt(fwMajorMinor[1]) : 0;
    const fwMinor = fwMajorMinor ? parseInt(fwMajorMinor[2]) : 0;
    const isOlderFirmware = (fwMajor < 6) || (fwMajor === 6 && fwMinor < 21);
    if (isOlderFirmware) {
      addLog('⚠ Firmware antigo detectado (' + fwVersion + ') - usando modo compatível', 'warn');
    }

    const cfgUrl = apiBase + '/set_configuration.fcgi?session=' + s;

    const postConfig = async (payload, label) => {
      const resp = await fetch(cfgUrl, { method:'POST', headers: hdr, body: JSON.stringify(payload) });
      if (!resp.ok) {
        const txt = await resp.text().catch(() => '');
        throw new Error(label + ' falhou (' + resp.status + ') ' + txt);
      }
      return resp;
    };

    const tryPostConfig = async (payload, label) => {
      try {
        const resp = await fetch(cfgUrl, { method:'POST', headers: hdr, body: JSON.stringify(payload) });
        if (!resp.ok) {
          const txt = await resp.text().catch(() => '');
          addLog('⚠ ' + label + ': ' + resp.status + ' ' + txt, 'warn');
          return false;
        }
        return true;
      } catch(e) {
        addLog('⚠ ' + label + ': ' + e.message, 'warn');
        return false;
      }
    };

    // Step 2: Create or find server object
    // Official docs: ip field should contain the FULL URL for the server
    // Older firmware may not support separate port field
    addLog('3. Configurando servidor online...', 'info');

    const loadObjects = async (payload) => {
      const resp = await fetch(apiBase + '/load_objects.fcgi?session=' + s, {
        method: 'POST', headers: hdr, body: JSON.stringify(payload)
      });
      if (!resp.ok) return [];
      const data = await resp.json().catch(() => ({}));
      if (Array.isArray(data.devices)) return data.devices;
      if (Array.isArray(data.values)) return data.values;
      if (Array.isArray(data.rows)) return data.rows;
      if (Array.isArray(data.objects)) return data.objects;
      return [];
    };

    // Check existing servers
    let existingServers = await loadObjects({ object: 'devices' });
    addLog('  Servidores existentes: ' + existingServers.length, 'info');

    let serverId = '';
    const portalGuard = existingServers.find(r => {
      const n = String(r.name || '').toLowerCase();
      const i = String(r.ip || '').toLowerCase();
      return n.includes('portalguard') || i.includes(desiredHost);
    });

    if (portalGuard) {
      serverId = String(portalGuard.id);
      addLog('✓ Servidor existente encontrado (id: ' + serverId + ')', 'ok');
    }

    const serverCandidates = isOlderFirmware
      ? [
          { name: 'PortalGuard Cloud', ip: desiredHost, port: '443', public_key: '' },
          { name: 'PortalGuard Cloud', ip: 'https://' + desiredHost, public_key: '' },
          { name: 'PortalGuard Cloud', ip: fullServerUrl, public_key: '' },
        ]
      : [
          { name: 'PortalGuard Cloud', ip: desiredHost, port: '443', public_key: '' },
          { name: 'PortalGuard Cloud', ip: 'https://' + desiredHost, port: '443', public_key: '' },
          { name: 'PortalGuard Cloud', ip: fullServerUrl, port: '443', public_key: '' },
        ];

    if (!serverId) {
      // Try create_objects with firmware-compatible formats
      const candidates = serverCandidates;

      for (const candidate of candidates) {
        addLog('  Tentando criar servidor: ip=' + candidate.ip + '...', 'info');
        try {
          const createResp = await fetch(apiBase + '/create_objects.fcgi?session=' + s, {
            method: 'POST', headers: hdr,
            body: JSON.stringify({ object: 'devices', values: [candidate] })
          });
          if (createResp.ok) {
            const cd = await createResp.json().catch(() => ({}));
            if (Array.isArray(cd.ids) && cd.ids.length > 0) {
              serverId = String(cd.ids[0]);
              addLog('✓ Servidor criado (id: ' + serverId + ')', 'ok');
              break;
            }
          } else {
            const txt = await createResp.text().catch(() => '');
            addLog('  create_objects retornou ' + createResp.status + ': ' + txt, 'info');
          }
        } catch(e) { addLog('  Erro: ' + e.message, 'info'); }
      }
    }

    // If still no server, try create_or_modify_objects
    if (!serverId) {
      addLog('  Tentando create_or_modify_objects...', 'info');
      const val = serverCandidates[0];
      try {
        const resp = await fetch(apiBase + '/create_or_modify_objects.fcgi?session=' + s, {
          method: 'POST', headers: hdr,
          body: JSON.stringify({ object: 'devices', values: [val] })
        });
        if (resp.ok) {
          // Reload to find it
          existingServers = await loadObjects({ object: 'devices' });
          const found = existingServers.find(r => String(r.name || '').toLowerCase().includes('portalguard'));
          if (found) {
            serverId = String(found.id);
            addLog('✓ Servidor criado via create_or_modify (id: ' + serverId + ')', 'ok');
          }
        }
      } catch(e) { /* ignore */ }
    }

    if (!serverId) {
      // Last resort: use first available server or id "1"
      if (existingServers.length > 0) {
        serverId = String(existingServers[0].id);
        addLog('⚠ Usando primeiro servidor disponível (id: ' + serverId + ')', 'warn');
      } else {
        throw new Error('Não foi possível criar ou encontrar servidor online');
      }
    }

    // Update server object with compatible endpoint formats
    addLog('4. Atualizando endpoint do servidor...', 'info');
    const idVariants = [String(serverId)];
    const serverIdNumForUpdate = Number(serverId);
    if (Number.isFinite(serverIdNumForUpdate) && String(serverIdNumForUpdate) === String(serverId)) {
      idVariants.push(serverIdNumForUpdate);
    }

    const tryModifyObject = async (payload, label) => {
      try {
        const resp = await fetch(apiBase + '/modify_objects.fcgi?session=' + s, {
          method: 'POST', headers: hdr, body: JSON.stringify(payload)
        });
        if (!resp.ok) {
          const txt = await resp.text().catch(() => '');
          addLog('⚠ ' + label + ': ' + resp.status + ' ' + txt, 'warn');
          return false;
        }
        return true;
      } catch (e) {
        addLog('⚠ ' + label + ': ' + e.message, 'warn');
        return false;
      }
    };

    let endpointUpdated = false;
    for (const candidate of serverCandidates) {
      for (const idVariant of idVariants) {
        const values = { name: 'PortalGuard Cloud', ip: candidate.ip, ...(candidate.port ? { port: candidate.port } : {}) };

        const byWhere = await tryModifyObject(
          { object: 'devices', values, where: { devices: { id: idVariant } } },
          'modify by where (' + candidate.ip + ')'
        );

        const byId = await tryModifyObject(
          { object: 'devices', values: [{ id: idVariant, ...values }] },
          'modify by id (' + candidate.ip + ')'
        );

        if (byWhere || byId) {
          endpointUpdated = true;
          addLog('✓ Endpoint aplicado: ' + candidate.ip, 'ok');
          break;
        }
      }

      if (endpointUpdated) break;
    }

    if (!endpointUpdated) {
      addLog('⚠ Não foi possível confirmar atualização do endpoint; continuando com configuração padrão', 'warn');
    }

    // Step 3: Set online_client.server_id - try string first, then number fallback
    addLog('5. Vinculando server_id no online_client...', 'info');
    const serverIdNum = Number(serverId);
    const serverIdStr = String(serverId);

    const idAttempts = [serverIdStr];
    if (Number.isFinite(serverIdNum) && String(serverIdNum) === serverIdStr) {
      idAttempts.push(serverIdNum);
    }

    let serverIdLinked = false;
    for (const idVal of idAttempts) {
      const ok = await tryPostConfig({ online_client: { server_id: idVal } }, 'online_client.server_id=' + JSON.stringify(idVal));
      if (ok) {
        addLog('✓ server_id aplicado: ' + JSON.stringify(idVal), 'ok');
        serverIdLinked = true;
        break;
      }
    }

    if (!serverIdLinked) {
      addLog('⚠ server_id não aceito como string nem como número - tentando continuar...', 'warn');
    }

    // Step 4: Configure Monitor
    addLog('6. Configurando Monitor...', 'info');
    await postConfig({
      monitor: {
        request_timeout: '15000',
        hostname: desiredHost,
        port: '443',
        path: webhookPath
      }
    }, 'monitor');
    addLog('✓ Monitor configurado', 'ok');

    // Step 5: Configure Push Server
    addLog('7. Configurando Push Server...', 'info');
    const pushRemoteAddress = 'https://' + desiredHost + webhookPath;
    await postConfig({
      push_server: {
        push_remote_address: pushRemoteAddress,
        push_request_timeout: '120000',
        push_request_period: '5'
      }
    }, 'push_server');
    addLog('✓ Push Server configurado (' + pushRemoteAddress + ')', 'ok');

    // Step 6: Activate online mode - try combined first, then separate for older firmware
    addLog('8. Ativando modo online...', 'info');
    const activationPayload = {
      general: { online: '1', local_identification: '1' },
      online_client: { extract_template: '0', max_request_attempts: '3' }
    };

    const combinedOk = await tryPostConfig(activationPayload, 'online+client combinado');
    if (!combinedOk) {
      // Older firmware might need these separately
      addLog('  Tentando configurações separadas...', 'info');
      await tryPostConfig({ general: { online: '1', local_identification: '1' } }, 'general.online');
      await tryPostConfig({ online_client: { extract_template: '0', max_request_attempts: '3' } }, 'online_client extras');
    }
    addLog('✓ Modo online ativado', 'ok');

    // Step 7: Verify
    addLog('9. Verificando configuração...', 'info');
    const vr = await fetch(apiBase + '/get_configuration.fcgi?session=' + s, {
      method:'POST', headers: hdr,
      body: JSON.stringify({ general:true, monitor:true, push_server:true, online_client:true })
    });

    if (vr.ok) {
      const vd = await vr.json();
      addLog('Online: ' + (vd.general?.online || '?'), vd.general?.online === '1' ? 'ok' : 'err');
      addLog('Monitor hostname: ' + (vd.monitor?.hostname || '?'), vd.monitor?.hostname ? 'ok' : 'err');
      addLog('Monitor port: ' + (vd.monitor?.port || '?'), 'ok');
      addLog('Push address: ' + (vd.push_server?.push_remote_address || '?'), vd.push_server?.push_remote_address ? 'ok' : 'err');
      addLog('server_id: ' + (vd.online_client?.server_id || '?'), vd.online_client?.server_id ? 'ok' : 'err');
    }

    // Verify server object
    const verifyServers = await loadObjects({ object: 'devices', where: { devices: { id: Number(serverId) } } });
    if (verifyServers.length > 0) {
      const sv = verifyServers[0];
      addLog('Servidor.ip: ' + (sv.ip || '?'), sv.ip ? 'ok' : 'err');
      addLog('Servidor.port: ' + (sv.port || 'N/A'), 'info');
    }

    addLog('\\n🎉 Configuração concluída!', 'ok');
    addLog('Firmware: ' + fwVersion + (isOlderFirmware ? ' (modo compatível)' : ''), 'info');
  } catch(e) {
    addLog('\\n✗ Erro: ' + (e?.message || e), 'err');
  }
}
</script></body></html>`;
  };

  const handleDiscoverSerials = () => {
    const devicesWithIp = devices.filter(d => d.ipAddress);
    if (devicesWithIp.length === 0) {
      toast.error('Nenhum dispositivo com IP cadastrado');
      return;
    }

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
    const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
    
    const deviceEntries = devicesWithIp.map(d => `{id:"${d.id}",ip:"${d.ipAddress}",name:"${d.name}"}`).join(',');

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Descobrir Seriais - Control iD</title>
<style>body{font-family:system-ui;max-width:600px;margin:40px auto;padding:20px}
.log{background:#f5f5f5;padding:12px;border-radius:8px;margin:12px 0;font-size:13px;white-space:pre-wrap}
.ok{color:green}.err{color:red}.info{color:#666}
h2{margin:0 0 16px}button{padding:10px 20px;border-radius:6px;border:none;background:#3b82f6;color:white;cursor:pointer;font-size:14px;margin-top:8px}
button:hover{background:#2563eb}table{width:100%;border-collapse:collapse;margin:16px 0}
th,td{border:1px solid #ddd;padding:8px;text-align:left;font-size:13px}
th{background:#f0f0f0}tr.found{background:#d4edda}</style></head>
<body><h2>🔍 Descoberta de Seriais Numéricos</h2>
<p>Este script consulta cada dispositivo para obter o serial numérico (device_id) e atualiza automaticamente no banco de dados.</p>
<div id="log" class="log"><span class="info">Clique em "Descobrir" para iniciar...</span></div>
<table id="results" style="display:none"><thead><tr><th>Nome</th><th>IP</th><th>Serial Numérico</th><th>Status</th></tr></thead><tbody id="tbody"></tbody></table>
<button onclick="run()">Descobrir Seriais</button>
<script>
const devices = [${deviceEntries}];
const log = document.getElementById('log');
const tbody = document.getElementById('tbody');
function addLog(msg, cls) { log.innerHTML += '\\n<span class="'+cls+'">'+msg+'</span>'; }

async function updateSerial(deviceDbId, numericSerial) {
  try {
    const resp = await fetch('${supabaseUrl}/rest/v1/devices?id=eq.' + deviceDbId, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': '${supabaseKey}',
        'Authorization': 'Bearer ${supabaseKey}',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ serial_number: numericSerial })
    });
    return resp.ok;
  } catch(e) { return false; }
}

async function run() {
  log.innerHTML = '<span class="info">Iniciando descoberta...</span>';
  document.getElementById('results').style.display = 'table';
  tbody.innerHTML = '';
  
  for (const dev of devices) {
    addLog('\\nConsultando ' + dev.name + ' (' + dev.ip + ')...', 'info');
    try {
      const lr = await fetch('http://' + dev.ip + '/login.fcgi', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({login:'admin',password:'admin'})
      });
      if (!lr.ok) throw new Error('Login falhou');
      const ld = await lr.json();
      const s = ld.session;
      
      const sr = await fetch('http://' + dev.ip + '/system_information.fcgi?session=' + s);
      if (!sr.ok) throw new Error('Consulta falhou');
      const sd = await sr.json();
      
      const numSerial = sd.device_id || sd.serial || 'N/A';
      addLog('✓ ' + dev.name + ': Serial numérico = ' + numSerial, 'ok');
      
      let dbStatus = 'Não atualizado';
      if (numSerial && numSerial !== 'N/A') {
        const ok = await updateSerial(dev.id, String(numSerial));
        dbStatus = ok ? '✅ Atualizado no banco!' : '❌ Erro ao atualizar';
        addLog(ok ? '  → Banco de dados atualizado!' : '  → Erro ao atualizar banco', ok ? 'ok' : 'err');
      }
      
      tbody.innerHTML += '<tr class="found"><td>'+dev.name+'</td><td>'+dev.ip+'</td><td><strong>'+numSerial+'</strong></td><td>'+dbStatus+'</td></tr>';
    } catch(e) {
      addLog('✗ ' + dev.name + ': ' + e.message, 'err');
      tbody.innerHTML += '<tr><td>'+dev.name+'</td><td>'+dev.ip+'</td><td>Erro</td><td>'+e.message+'</td></tr>';
    }
  }
  addLog('\\n🎉 Descoberta concluída! Recarregue a página de dispositivos.', 'ok');
}
</script></body></html>`;

    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'descobrir-seriais.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast.info('Arquivo de descoberta baixado!', {
      duration: 10000,
      description: 'Abra o arquivo "descobrir-seriais.html" no navegador e clique em "Descobrir". Os seriais serão atualizados automaticamente.',
    });
  };

  const executeLocalConfig = async (ip: string, port: string, hostname: string) => {
    const baseUrl = `http://${ip}:${port}`;

    try {
      const loginResp = await fetch(`${baseUrl}/login.fcgi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: 'admin', password: 'admin' }),
      });

      if (!loginResp.ok) {
        throw new Error(`Login falhou (status ${loginResp.status}). Verifique as credenciais.`);
      }

      const loginData = await loginResp.json();
      const session = loginData.session;
      if (!session) throw new Error('Sessão não retornada pelo dispositivo');

      let fwVersion = 'unknown';
      try {
        const sysResp = await fetch(`${baseUrl}/system_information.fcgi?session=${session}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        if (sysResp.ok) {
          const sysData = await sysResp.json();
          fwVersion = String(sysData?.firmware || sysData?.version || 'unknown');
        }
      } catch {
        // ignore
      }

      const fwMajorMinor = fwVersion.match(/(\d+)\.(\d+)/);
      const fwMajor = fwMajorMinor ? Number.parseInt(fwMajorMinor[1], 10) : 0;
      const fwMinor = fwMajorMinor ? Number.parseInt(fwMajorMinor[2], 10) : 0;
      const isOlderFirmware = fwMajor < 6 || (fwMajor === 6 && fwMinor < 21);

      const webhookPath = '/functions/v1/controlid-webhook';
      const fullServerUrl = `https://${hostname}${webhookPath}`;

      const monitorConfig = {
        monitor: {
          request_timeout: '15000',
          hostname,
          port: '443',
          path: webhookPath,
        },
      };

      const pushConfig = {
        push_server: {
          push_remote_address: `https://${hostname}${webhookPath}`,
          push_request_timeout: '120000',
          push_request_period: '5',
        },
      };

      const postConfig = async (payload: Record<string, unknown>, label: string) => {
        const resp = await fetch(`${baseUrl}/set_configuration.fcgi?session=${session}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!resp.ok) {
          const details = await resp.text().catch(() => '');
          throw new Error(`${label} falhou (status ${resp.status})${details ? `: ${details}` : ''}`);
        }
      };

      const tryPostConfig = async (payload: Record<string, unknown>) => {
        const resp = await fetch(`${baseUrl}/set_configuration.fcgi?session=${session}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        return resp.ok;
      };

      const asArray = (data: any): any[] => {
        if (!data || typeof data !== 'object') return [];
        if (Array.isArray(data.devices)) return data.devices;
        if (Array.isArray(data.values)) return data.values;
        if (Array.isArray(data.rows)) return data.rows;
        if (Array.isArray(data.objects)) return data.objects;
        return [];
      };

      const normalizeServer = (row: any) => {
        if (!row) return { id: '', ip: '', port: '' };
        const ipValue = String(row.ip || row.server || '').trim();
        const explicitPort = String(row.port || '').trim();
        const portMatch = ipValue.match(/:(\d+)/);
        const inferredPort = portMatch?.[1] || (ipValue.startsWith('https://') ? '443' : '');
        return { id: String(row.id ?? row.device_id ?? ''), ip: ipValue, port: explicitPort || inferredPort };
      };

      const isPortalGuardServer = (row: any) => {
        const name = String(row?.name || '').toLowerCase();
        const ipValue = String(row?.ip || '').toLowerCase();
        return name === 'portalguard cloud' || ipValue.includes(hostname.toLowerCase());
      };

      const loadServers = async (wherePayload?: Record<string, any>) => {
        const response = await fetch(`${baseUrl}/load_objects.fcgi?session=${session}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ object: 'devices', ...(wherePayload || {}) }),
        });

        if (!response.ok) return [];
        const data = await response.json().catch(() => ({}));
        return asArray(data);
      };

      const loadServerById = async (serverId: string) => {
        const idVariants: Array<string | number> = [serverId];
        const numericId = Number(serverId);
        if (Number.isFinite(numericId) && String(numericId) === String(serverId)) {
          idVariants.push(numericId);
        }

        for (const idVariant of idVariants) {
          const rows = await loadServers({ where: { devices: { id: idVariant } } });
          if (rows.length > 0) return normalizeServer(rows[0]);
        }

        return { id: '', ip: '', port: '' };
      };

      const serverCandidates = isOlderFirmware
        ? [
            { name: 'PortalGuard Cloud', ip: hostname, port: '443', public_key: '' },
            { name: 'PortalGuard Cloud', ip: `https://${hostname}`, public_key: '' },
            { name: 'PortalGuard Cloud', ip: fullServerUrl, public_key: '' },
          ]
        : [
            { name: 'PortalGuard Cloud', ip: hostname, port: '443', public_key: '' },
            { name: 'PortalGuard Cloud', ip: `https://${hostname}`, port: '443', public_key: '' },
            { name: 'PortalGuard Cloud', ip: fullServerUrl, port: '443', public_key: '' },
          ];

      const findOrCreateServer = async () => {
        const existingByName = await loadServers({ where: { devices: { name: 'PortalGuard Cloud' } } });
        const preferred = existingByName.find(isPortalGuardServer) || existingByName[0] || null;
        if (preferred?.id !== undefined) return normalizeServer(preferred);

        for (const candidate of serverCandidates) {
          const createResp = await fetch(`${baseUrl}/create_objects.fcgi?session=${session}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ object: 'devices', values: [candidate] }),
          });

          if (!createResp.ok) continue;
          const createData = await createResp.json().catch(() => ({}));
          const createdId = Array.isArray(createData?.ids) && createData.ids.length > 0 ? String(createData.ids[0]) : '';
          if (createdId) return { id: createdId, ip: candidate.ip, port: candidate.port || '' };
        }

        const fallback = (await loadServers({})).find(isPortalGuardServer);
        return fallback ? normalizeServer(fallback) : { id: '', ip: '', port: '' };
      };

      const tryModifyServer = async (payload: Record<string, unknown>) => {
        const resp = await fetch(`${baseUrl}/modify_objects.fcgi?session=${session}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        return resp.ok;
      };

      const applyServerEndpoint = async (serverId: string) => {
        const idVariants: Array<string | number> = [serverId];
        const numericId = Number(serverId);
        if (Number.isFinite(numericId) && String(numericId) === String(serverId)) {
          idVariants.push(numericId);
        }

        for (const candidate of serverCandidates) {
          const values = {
            name: 'PortalGuard Cloud',
            ip: candidate.ip,
            ...(candidate.port ? { port: candidate.port } : {}),
          };

          for (const idVariant of idVariants) {
            const okWhere = await tryModifyServer({ object: 'devices', values, where: { devices: { id: idVariant } } });
            const okById = await tryModifyServer({ object: 'devices', values: [{ id: idVariant, ...values }] });

            if (!okWhere && !okById) continue;

            const reloaded = await loadServerById(String(serverId));
            if (String(reloaded.ip).toLowerCase().includes(hostname.toLowerCase())) {
              return reloaded;
            }
          }
        }

        return await loadServerById(serverId);
      };

      const server = await findOrCreateServer();
      if (!server.id) throw new Error('Não foi possível criar ou localizar servidor online (objeto devices)');

      const updatedServer = await applyServerEndpoint(server.id);
      const serverHostApplied = updatedServer.ip || server.ip;
      const serverPortApplied = updatedServer.port || server.port || 'N/A';

      const serverIdString = String(server.id);
      const serverIdNumber = Number(server.id);
      const serverIdAttempts: Array<string | number> = [serverIdString];
      if (Number.isFinite(serverIdNumber) && String(serverIdNumber) === serverIdString) {
        serverIdAttempts.push(serverIdNumber);
      }

      let linkedServerIdValue: string | number | null = null;
      for (const candidateId of serverIdAttempts) {
        try {
          await postConfig({ online_client: { server_id: candidateId } }, `online_client.server_id (${typeof candidateId})`);
          linkedServerIdValue = candidateId;
          break;
        } catch {
          // try next candidate type
        }
      }

      await postConfig(monitorConfig, 'monitor');
      await postConfig(pushConfig, 'push_server');

      const onlineClientPayload: Record<string, unknown> = {
        extract_template: '0',
        max_request_attempts: '3',
      };
      if (linkedServerIdValue !== null) {
        onlineClientPayload.server_id = linkedServerIdValue;
      }

      const combinedOk = await tryPostConfig({
        online_client: onlineClientPayload,
        general: { online: '1', local_identification: '1' },
      });

      if (!combinedOk) {
        await tryPostConfig({ general: { online: '1', local_identification: '1' } });
        await tryPostConfig({ online_client: onlineClientPayload });
      }

      let verifyData: any = null;
      try {
        const verifyResp = await fetch(`${baseUrl}/get_configuration.fcgi?session=${session}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ general: true, monitor: true, push_server: true, online_client: true }),
        });
        if (verifyResp.ok) verifyData = await verifyResp.json();
      } catch {
        // ignore
      }

      const appliedHostname = verifyData?.monitor?.hostname || '';
      const appliedPush = verifyData?.push_server?.push_remote_address || '';
      const appliedOnline = verifyData?.general?.online || '';
      const appliedServerId = verifyData?.online_client?.server_id || linkedServerIdValue || '?';

      toast.success('Configuração aplicada com sucesso via rede local!', {
        duration: 8000,
        description: `FW: ${fwVersion} | Online: ${appliedOnline || '?'} | Server ID: ${String(appliedServerId)} | Servidor: ${serverHostApplied}:${serverPortApplied} | Monitor: ${appliedHostname || hostname} | Push: ${appliedPush || `https://${hostname}${webhookPath}`}`,
      });
    } catch (err: any) {
      console.error('Error configuring device locally:', err);
      toast.error('Erro ao configurar dispositivo via rede local', {
        duration: 7000,
        description: err.message || 'Verifique se o dispositivo está acessível na rede.',
      });
    }
  };


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const isNew = !editingId;
    const deviceData: Device = {
      id: editingId || `dev_${Date.now()}`,
      ...formData,
      lastSync: new Date().toISOString(),
    };

    const success = await saveDevice(deviceData);
    if (success) {
      resetForm();
      // Auto-configure new devices
      if (isNew && deviceData.ipAddress) {
        toast.info('Aplicando configuração do webhook automaticamente...');
        await handleLocalConfig(deviceData);
      } else if (isNew && deviceData.serialNumber) {
        toast.info('Sincronizando configuração via push queue...');
        await handlePushConfig(deviceData);
      }
    }
  };

  const handleEdit = (device: Device) => {
    setEditingId(device.id);
    setFormData({
      name: device.name,
      type: device.type,
      location: device.location,
      status: device.status,
      ipAddress: device.ipAddress || '',
      serialNumber: device.serialNumber || '',
    });
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Deseja realmente excluir este dispositivo?')) return;
    await deleteDevice(id);
  };

  const toggleStatus = async (id: string) => {
    const device = devices.find(d => d.id === id);
    if (!device) return;
    
    const updatedDevice: Device = {
      ...device,
      status: device.status === 'online' ? 'offline' : 'online',
      lastSync: new Date().toISOString()
    };
    
    await saveDevice(updatedDevice);
  };

  const resetForm = () => {
    setEditingId('');
    setFormData({
      name: '',
      type: 'facial_recognition',
      location: '',
      status: 'online',
      ipAddress: '',
      serialNumber: '',
    });
    setShowForm(false);
  };

  const getDeviceIcon = (type: Device['type']) => {
    switch (type) {
      case 'facial_recognition':
        return <Camera className="h-5 w-5" />;
      case 'vehicle_tag':
        return <Tag className="h-5 w-5" />;
      case 'card_reader':
        return <CreditCard className="h-5 w-5" />;
    }
  };

  const getDeviceTypeName = (type: Device['type']) => {
    switch (type) {
      case 'facial_recognition':
        return 'Reconhecimento Facial';
      case 'vehicle_tag':
        return 'TAG Veicular';
      case 'card_reader':
        return 'Leitor de Cartão';
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold text-foreground mb-2">Dispositivos</h2>
          <p className="text-muted-foreground">Gerencie os dispositivos de controle de acesso</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleDiscoverSerials}>
            <Search className="h-4 w-4 mr-2" />
            Descobrir Seriais
          </Button>
          <Button onClick={() => setShowForm(!showForm)}>
            <Plus className="h-4 w-4 mr-2" />
            Novo Dispositivo
          </Button>
        </div>
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>{editingId ? 'Editar Dispositivo' : 'Novo Dispositivo'}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Nome do Dispositivo *</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Ex: Portaria Principal"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="type">Tipo *</Label>
                  <Select 
                    value={formData.type} 
                    onValueChange={(value: Device['type']) => setFormData({ ...formData, type: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="facial_recognition">📷 Reconhecimento Facial</SelectItem>
                      <SelectItem value="vehicle_tag">🏷️ TAG Veicular</SelectItem>
                      <SelectItem value="card_reader">💳 Leitor de Cartão</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="location">Localização *</Label>
                  <Input
                    id="location"
                    value={formData.location}
                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                    placeholder="Ex: Portaria 1, Garagem, etc."
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="status">Status *</Label>
                  <Select 
                    value={formData.status} 
                    onValueChange={(value: Device['status']) => setFormData({ ...formData, status: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="online">🟢 Online</SelectItem>
                      <SelectItem value="offline">🔴 Offline</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ipAddress">Endereço IP</Label>
                  <Input
                    id="ipAddress"
                    value={formData.ipAddress}
                    onChange={(e) => setFormData({ ...formData, ipAddress: e.target.value })}
                    placeholder="192.168.1.100"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="serialNumber">Número de Série</Label>
                  <Input
                    id="serialNumber"
                    value={formData.serialNumber}
                    onChange={(e) => setFormData({ ...formData, serialNumber: e.target.value })}
                    placeholder="SN12345678"
                  />
                </div>
              </div>

              <div className="flex space-x-2">
                <Button type="submit" className="flex-1">
                  {editingId ? 'Salvar Alterações' : 'Cadastrar Dispositivo'}
                </Button>
                <Button type="button" variant="secondary" onClick={resetForm}>
                  Cancelar
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {devices.length === 0 ? (
          <Card className="col-span-full">
            <CardContent className="py-8">
              <p className="text-center text-muted-foreground">
                Nenhum dispositivo cadastrado. Clique em "Novo Dispositivo" para começar.
              </p>
            </CardContent>
          </Card>
        ) : (
          devices.map((device) => (
            <Card key={device.id} className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-2">
                    <div className={`p-2 rounded-lg ${device.status === 'online' ? 'bg-success/20' : 'bg-destructive/20'}`}>
                      {getDeviceIcon(device.type)}
                    </div>
                    <div>
                      <CardTitle className="text-lg">{device.name}</CardTitle>
                      <p className="text-xs text-muted-foreground">{getDeviceTypeName(device.type)}</p>
                    </div>
                  </div>
                  <Badge variant={device.status === 'online' ? 'default' : 'destructive'}>
                    {device.status === 'online' ? <Wifi className="h-3 w-3 mr-1" /> : <WifiOff className="h-3 w-3 mr-1" />}
                    {device.status === 'online' ? 'Online' : 'Offline'}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Localização:</span>
                    <span className="font-medium">{device.location}</span>
                  </div>
                  {device.ipAddress && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">IP:</span>
                      <span className="font-mono text-xs">{device.ipAddress}</span>
                    </div>
                  )}
                  {device.serialNumber && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Série:</span>
                      <span className="font-mono text-xs">{device.serialNumber}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Última Sync:</span>
                    <span className="text-xs">{new Date(device.lastSync).toLocaleString('pt-BR')}</span>
                  </div>
                </div>

                <div className="flex gap-2 pt-2 flex-wrap">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handlePushConfig(device)}
                    disabled={pushingConfig === device.id}
                    className="flex-1"
                    title="Enviar configuração do monitor ao dispositivo via Push"
                  >
                    {pushingConfig === device.id ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                    ) : (
                      <Settings2 className="h-3.5 w-3.5 mr-1" />
                    )}
                    Enviar Config
                  </Button>
                  {device.ipAddress && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleLocalConfig(device)}
                      disabled={localConfigLoading === device.id}
                      className="flex-1"
                      title="Configurar via rede local (navegador → dispositivo)"
                    >
                      {localConfigLoading === device.id ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                      ) : (
                        <Network className="h-3.5 w-3.5 mr-1" />
                      )}
                      Config Local
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => toggleStatus(device.id)}
                    className="flex-1"
                  >
                    {device.status === 'online' ? 'Desativar' : 'Ativar'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleEdit(device)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleDelete(device.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
};
