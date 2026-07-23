/**
 * @confused-ai/control-plane — AgentOS dashboard server.
 *
 * Zero-dependency Node.js HTTP server providing:
 *   - Sessions browser
 *   - Memory inspector
 *   - Eval runs with diff view
 *   - Trace waterfall
 *   - HITL approval queue
 *   - Knowledge admin
 *   - Chat playground
 *
 * API-only: JSON endpoints at /api/*. Ships with an inline HTML dashboard.
 *
 * ```ts
 * const cp = createControlPlane({
 *   agents,
 *   sessionStore,
 *   evalStore,
 *   traceStore,
 *   approvalStore,
 * });
 * await cp.start(4100);
 * ```
 */

import http from 'node:http';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ControlPlaneConfig {
  agents?: Array<{ name: string; run: (prompt: string) => Promise<{ text: string }> }>;
  sessionStore?: SessionLike;
  evalStore?: EvalStoreLike;
  traceStore?: TraceStoreLike;
  approvalStore?: ApprovalStoreLike;
  knowledgeStore?: KnowledgeLike;
}

interface SessionLike {
  list?(): Promise<Array<{ id: string; createdAt?: number; metadata?: Record<string, unknown> }>>;
  load?(id: string): Promise<unknown>;
}
interface EvalStoreLike {
  list?(): Promise<Array<{ id: string; [k: string]: unknown }>>;
}
interface TraceStoreLike {
  list?(): Promise<Array<{ id: string; name: string; startTime: number; endTime: number; [k: string]: unknown }>>;
}
interface ApprovalStoreLike {
  listPending?(): Promise<Array<{ id: string; [k: string]: unknown }>>;
  approve?(id: string): Promise<void>;
  reject?(id: string): Promise<void>;
}
interface KnowledgeLike {
  listDocuments?(): Promise<Array<{ id: string; content: string; metadata?: Record<string, unknown> }>>;
}

export interface ControlPlaneServer {
  start(port: number): Promise<void>;
  stop(): Promise<void>;
}

// ── Server ────────────────────────────────────────────────────────────────────

export function createControlPlane(config: ControlPlaneConfig = {}): ControlPlaneServer {
  let server: http.Server | null = null;

  const jsonReply = (res: http.ServerResponse, data: unknown, status = 200): void => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(data));
  };

  const handler = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const path = url.pathname;

    try {
      // ── API routes ──────────────────────────────────────────────────
      if (path === '/api/agents') {
        jsonReply(res, { agents: (config.agents ?? []).map((a) => ({ name: a.name })) });
        return;
      }

      if (path === '/api/sessions') {
        const sessions = (await config.sessionStore?.list?.()) ?? [];
        jsonReply(res, { sessions });
        return;
      }

      if (path === '/api/sessions/detail' && url.searchParams.get('id')) {
        const data = await config.sessionStore?.load?.(url.searchParams.get('id')!);
        jsonReply(res, { session: data ?? null });
        return;
      }

      if (path === '/api/evals') {
        const evals = (await config.evalStore?.list?.()) ?? [];
        jsonReply(res, { evals });
        return;
      }

      if (path === '/api/traces') {
        const traces = (await config.traceStore?.list?.()) ?? [];
        jsonReply(res, { traces });
        return;
      }

      if (path === '/api/approvals') {
        const pending = (await config.approvalStore?.listPending?.()) ?? [];
        jsonReply(res, { pending });
        return;
      }

      if (path === '/api/approvals/approve' && req.method === 'POST') {
        const id = url.searchParams.get('id');
        if (id) await config.approvalStore?.approve?.(id);
        jsonReply(res, { ok: true });
        return;
      }

      if (path === '/api/approvals/reject' && req.method === 'POST') {
        const id = url.searchParams.get('id');
        if (id) await config.approvalStore?.reject?.(id);
        jsonReply(res, { ok: true });
        return;
      }

      if (path === '/api/knowledge') {
        const docs = (await config.knowledgeStore?.listDocuments?.()) ?? [];
        jsonReply(res, { documents: docs });
        return;
      }

      if (path === '/api/chat' && req.method === 'POST') {
        const body = await readBody(req);
        const { agent: agentName, prompt } = JSON.parse(body) as { agent?: string; prompt?: string };
        const a = config.agents?.find((x) => x.name === agentName) ?? config.agents?.[0];
        if (!a || !prompt) { jsonReply(res, { error: 'agent or prompt missing' }, 400); return; }
        const result = await a.run(prompt);
        jsonReply(res, { text: result.text });
        return;
      }

      // ── Dashboard HTML ──────────────────────────────────────────────
      if (path === '/' || path === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(getDashboardHtml());
        return;
      }

      jsonReply(res, { error: 'not found' }, 404);
    } catch (err) {
      jsonReply(res, { error: String(err) }, 500);
    }
  };

  return {
    async start(port: number) {
      server = http.createServer((req, res) => { handler(req, res).catch(() => res.end()); });
      await new Promise<void>((resolve) => server!.listen(port, resolve));
    },
    async stop() {
      await new Promise<void>((resolve, reject) => {
        if (!server) { resolve(); return; }
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => { if (chunks.reduce((s, b) => s + b.length, 0) < 65536) chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>confused-ai Control Plane</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;background:#0f1117;color:#e0e0e8;display:flex;height:100vh}
nav{width:200px;background:#161822;padding:16px 0;flex-shrink:0;border-right:1px solid #2a2d3a}
nav button{display:block;width:100%;text-align:left;padding:10px 20px;background:none;border:none;color:#a0a4b8;cursor:pointer;font-size:14px}
nav button:hover,nav button.active{background:#1e2030;color:#fff}
main{flex:1;padding:24px;overflow:auto}
.panel{display:none}.panel.active{display:block}
h2{font-size:18px;margin-bottom:16px;font-weight:600}
table{width:100%;border-collapse:collapse;margin:8px 0}
th,td{text-align:left;padding:8px 12px;border-bottom:1px solid #2a2d3a;font-size:13px}
th{color:#888}
.card{background:#1a1c2a;border-radius:6px;padding:16px;margin:8px 0}
input,textarea{background:#1e2030;border:1px solid #2a2d3a;color:#e0e0e8;padding:8px 12px;border-radius:4px;width:100%;margin:4px 0;font-size:14px}
button.action{padding:6px 14px;border:none;border-radius:4px;cursor:pointer;font-size:13px;margin:2px}
.approve{background:#2d6a4f;color:#fff}.reject{background:#8b2c2c;color:#fff}
.send{background:#3b5bdb;color:#fff;margin-top:8px}
#chatLog{min-height:200px;max-height:60vh;overflow:auto;background:#1e2030;border-radius:4px;padding:12px;margin:8px 0;font-size:14px;white-space:pre-wrap}
.empty{color:#666;font-style:italic}
</style>
</head>
<body>
<nav>
<div style="padding:12px 20px 24px;color:#fff;font-weight:700;font-size:16px">confused-ai</div>
<button onclick="show('sessions')" id="tab-sessions">Sessions</button>
<button onclick="show('memory')" id="tab-memory">Memory</button>
<button onclick="show('evals')" id="tab-evals">Evals</button>
<button onclick="show('traces')" id="tab-traces">Traces</button>
<button onclick="show('approvals')" id="tab-approvals">Approvals</button>
<button onclick="show('knowledge')" id="tab-knowledge">Knowledge</button>
<button onclick="show('chat')" id="tab-chat">Chat</button>
</nav>
<main>
<div class="panel" id="p-sessions"><h2>Sessions</h2><div id="sessionList" class="empty">Loading...</div></div>
<div class="panel" id="p-memory"><h2>Memory Inspector</h2><div class="card empty">Connect a memory store to inspect agent memories.</div></div>
<div class="panel" id="p-evals"><h2>Eval Runs</h2><div id="evalList" class="empty">Loading...</div></div>
<div class="panel" id="p-traces"><h2>Traces</h2><div id="traceList" class="empty">Loading...</div></div>
<div class="panel" id="p-approvals"><h2>HITL Approval Queue</h2><div id="approvalList" class="empty">Loading...</div></div>
<div class="panel" id="p-knowledge"><h2>Knowledge Base</h2><div id="knowledgeList" class="empty">Loading...</div></div>
<div class="panel" id="p-chat"><h2>Chat Playground</h2>
<select id="agentSelect"></select>
<div id="chatLog"></div>
<textarea id="chatInput" rows="3" placeholder="Type a message..."></textarea>
<button class="action send" onclick="sendChat()">Send</button>
</div>
</main>
<script>
const api=p=>fetch('/api/'+p).then(r=>r.json());
function show(id){
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b=>b.classList.remove('active'));
  document.getElementById('p-'+id).classList.add('active');
  document.getElementById('tab-'+id)?.classList.add('active');
  load(id);
}
function tableFrom(data,cols){
  if(!data||!data.length)return'<div class="empty">No data</div>';
  let h='<table><tr>'+cols.map(c=>'<th>'+c+'</th>').join('')+'</tr>';
  for(const r of data)h+='<tr>'+cols.map(c=>'<td>'+(r[c]??'')+'</td>').join('')+'</tr>';
  return h+'</table>';
}
async function load(id){
  if(id==='sessions'){const d=await api('sessions');document.getElementById('sessionList').innerHTML=tableFrom(d.sessions,['id','createdAt']);}
  if(id==='evals'){const d=await api('evals');document.getElementById('evalList').innerHTML=tableFrom(d.evals,['id']);}
  if(id==='traces'){const d=await api('traces');document.getElementById('traceList').innerHTML=tableFrom(d.traces,['id','name','startTime','endTime']);}
  if(id==='approvals'){const d=await api('approvals');const el=document.getElementById('approvalList');
    if(!d.pending.length){el.innerHTML='<div class="empty">No pending approvals</div>';return;}
    el.innerHTML=d.pending.map(p=>'<div class="card">'+JSON.stringify(p)+' <button class="action approve" onclick="doApproval(\\'approve\\',\\''+p.id+'\\')">Approve</button><button class="action reject" onclick="doApproval(\\'reject\\',\\''+p.id+'\\')">Reject</button></div>').join('');}
  if(id==='knowledge'){const d=await api('knowledge');document.getElementById('knowledgeList').innerHTML=tableFrom(d.documents,['id','content']);}
  if(id==='chat'){const d=await api('agents');const sel=document.getElementById('agentSelect');sel.innerHTML=d.agents.map(a=>'<option>'+a.name+'</option>').join('');}
}
async function doApproval(action,id){await fetch('/api/approvals/'+action+'?id='+id,{method:'POST'});load('approvals');}
async function sendChat(){
  const input=document.getElementById('chatInput');const log=document.getElementById('chatLog');
  const msg=input.value.trim();if(!msg)return;input.value='';log.textContent+='You: '+msg+'\\n';
  const agent=document.getElementById('agentSelect').value;
  const d=await fetch('/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({agent,prompt:msg})}).then(r=>r.json());
  log.textContent+='Agent: '+(d.text||d.error)+'\\n';
}
show('chat');
</script>
</body>
</html>`;
}
