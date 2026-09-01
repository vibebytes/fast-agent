export const DEBUG_PAGE_HTML = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Fast Agent · LLM Debug</title>
<style>
  :root {
    --bg: #0b0f17;
    --bg-soft: #111726;
    --panel: #151c2c;
    --panel-2: #1a2335;
    --border: #243049;
    --text: #e6ecf5;
    --muted: #8a97b1;
    --accent: #5eead4;
    --system: #60a5fa;
    --user: #22d3ee;
    --assistant: #34d399;
    --tool: #fbbf24;
    --other: #c084fc;
    --reasoning: #c084fc;
    --answer: #5eead4;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    background: radial-gradient(1200px 600px at 80% -10%, #16223b 0%, var(--bg) 55%);
    color: var(--text);
    font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    display: flex; flex-direction: column;
  }
  header {
    display: flex; align-items: center; gap: 14px;
    padding: 14px 20px; border-bottom: 1px solid var(--border);
    background: rgba(17,23,38,0.7); backdrop-filter: blur(8px);
    position: sticky; top: 0; z-index: 5;
  }
  .brand { font-weight: 700; letter-spacing: .3px; }
  .brand .dot { color: var(--accent); }
  .pill { font-size: 12px; color: var(--muted); background: var(--panel); border: 1px solid var(--border); padding: 3px 10px; border-radius: 999px; }
  .status { display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--muted); margin-left: auto; }
  .status .led { width: 9px; height: 9px; border-radius: 50%; background: #ef4444; box-shadow: 0 0 8px #ef4444; }
  .status.live .led { background: #34d399; box-shadow: 0 0 10px #34d399; }
  main { flex: 1; display: grid; grid-template-columns: 280px 1fr; min-height: 0; }
  aside {
    border-right: 1px solid var(--border); overflow-y: auto; padding: 12px;
    background: linear-gradient(180deg, rgba(21,28,44,0.6), rgba(11,15,23,0.3));
  }
  aside h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--muted); margin: 6px 8px 12px; }
  .turn { padding: 10px 12px; border-radius: 10px; cursor: pointer; border: 1px solid transparent; margin-bottom: 6px; transition: .15s; }
  .turn:hover { background: var(--panel); }
  .turn.active { background: var(--panel-2); border-color: var(--border); }
  .turn .t-title { font-weight: 600; }
  .turn .t-meta { font-size: 12px; color: var(--muted); margin-top: 2px; display: flex; gap: 8px; flex-wrap: wrap; }
  .turn .chip { font-size: 11px; padding: 1px 7px; border-radius: 999px; background: rgba(255,255,255,.05); }
  .content { overflow-y: auto; padding: 18px 20px 60px; }
  .toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; color: var(--muted); font-size: 13px; }
  .toolbar label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
  
  .guide { border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; margin-bottom: 20px; background: rgba(94,234,212,.04); color: var(--muted); font-size: 12.5px; line-height: 1.6; }
  .guide strong { color: var(--text); font-weight: 650; }
  .flow { display: inline-flex; align-items: center; gap: 6px; margin-left: 8px; color: var(--accent); font-weight: 600; }
  .section-title { display: flex; align-items: center; gap: 10px; margin: 24px 0 14px; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 1px; }
  .section-title::after { content: ''; flex: 1; height: 1px; background: var(--border); }
  .phase { font-size: 11px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--border); color: var(--muted); text-transform: none; letter-spacing: 0; }
  
  .badge { font-size: 11px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; padding: 2px 9px; border-radius: 6px; color: #061018; display: inline-block; }
  .role-system .badge { background: var(--system); }
  .role-user .badge { background: var(--user); }
  .role-assistant .badge { background: var(--assistant); }
  .role-tool .badge { background: var(--tool); }
  .role-other .badge { background: var(--other); }

  /* Timeline Styles */
  .timeline {
    position: relative;
    padding-left: 36px;
    margin: 16px 0 40px;
  }
  .timeline::before {
    content: '';
    position: absolute;
    left: 11px;
    top: 12px;
    bottom: 12px;
    width: 2px;
    background: var(--border);
  }
  .t-step {
    position: relative;
    margin-bottom: 24px;
  }
  .t-step-node {
    position: absolute;
    left: -36px;
    top: 8px;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--bg-soft);
    border: 2px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    z-index: 2;
    box-shadow: 0 0 8px rgba(0,0,0,.5);
  }
  .t-step.role-system .t-step-node { border-color: var(--system); color: var(--system); }
  .t-step.role-user .t-step-node { border-color: var(--user); color: var(--user); }
  .t-step.role-assistant .t-step-node { border-color: var(--assistant); color: var(--assistant); }
  .t-step.role-tool .t-step-node { border-color: var(--tool); color: var(--tool); }
  .t-step.role-response .t-step-node { border-color: var(--accent); color: var(--accent); background: rgba(94,234,212,.1); }

  .t-card {
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--panel);
    overflow: hidden;
    box-shadow: 0 4px 20px rgba(0,0,0,.2);
    transition: border-color .15s, box-shadow .15s;
  }
  .t-card:hover {
    border-color: rgba(255,255,255,.1);
    box-shadow: 0 6px 24px rgba(0,0,0,.3);
  }
  .t-card-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    background: rgba(255,255,255,.02);
    cursor: pointer;
    user-select: none;
  }
  .t-card-head .title {
    font-weight: 600;
    font-size: 13.5px;
    color: var(--text);
  }
  .t-card-head .meta {
    margin-left: auto;
    font-size: 12px;
    color: var(--muted);
  }
  .t-card-head .caret {
    color: var(--muted);
    transition: transform .15s;
    font-size: 12px;
  }
  .t-card.collapsed .caret {
    transform: rotate(-90deg);
  }
  .t-card.collapsed pre, .t-card.collapsed .t-card-desc {
    display: none;
  }
  .t-card-desc {
    padding: 6px 14px 7px;
    border-bottom: 1px solid rgba(255,255,255,.04);
    font-size: 11px;
    color: rgba(138,151,177,.72);
    background: rgba(255,255,255,.006);
    line-height: 1.45;
  }
  .t-card-desc strong {
    color: rgba(138,151,177,.86);
    font-weight: 500;
  }
  
  /* Color theme overrides for cards */
  .t-step.role-system .t-card { border-left: 3px solid var(--system); }
  .t-step.role-user .t-card { border-left: 3px solid var(--user); }
  .t-step.role-assistant .t-card { border-left: 3px solid var(--assistant); }
  .t-step.role-tool .t-card { border-left: 3px solid var(--tool); }
  .t-step.role-response .t-card { border-left: 3px solid var(--accent); }
  
  .t-step.role-response .t-card.reasoning { border-left-color: var(--reasoning); background: rgba(192,132,252,.02); }
  .t-step.role-response .t-card.answer { border-left-color: var(--answer); background: rgba(94,234,212,.02); }
  
  .pending { border: 1px dashed var(--border); border-radius: 12px; padding: 16px; color: var(--muted); background: rgba(255,255,255,.01); text-align: center; }

  pre {
    margin: 0; padding: 14px; white-space: pre-wrap; word-break: break-word;
    font: 12.5px/1.6 "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
    color: #cdd6e6; max-height: 520px; overflow: auto; background: rgba(0,0,0,.18);
  }
  .dup { display: flex; align-items: center; gap: 10px; padding: 7px 14px; margin-bottom: 8px; border: 1px dashed var(--border); border-radius: 10px; color: var(--muted); cursor: pointer; font-size: 12px; background: rgba(255,255,255,.015); }
  .dup:hover { color: var(--text); border-color: var(--accent); }
  .dup .badge { opacity: .65; }
  .empty { color: var(--muted); text-align: center; margin-top: 80px; }
  .copy { background: transparent; border: 1px solid var(--border); color: var(--muted); border-radius: 6px; font-size: 11px; padding: 2px 8px; cursor: pointer; }
  .copy:hover { color: var(--text); border-color: var(--accent); }
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-thumb { background: #26324a; border-radius: 8px; }
</style>
</head>
<body>
<header>
  <span class="brand">Fast Agent <span class="dot">·</span> LLM Debug</span>
  <span class="pill" id="model">model —</span>
  <span class="status" id="status"><span class="led"></span><span id="status-text">connecting…</span></span>
</header>
<main>
  <aside><h2>LLM Calls / 请求</h2><div id="turns"></div></aside>
  <section class="content">
    <div class="toolbar">
      <label><input type="checkbox" id="follow" checked /> 跟随最新</label>
      <label><input type="checkbox" id="dedupe" checked /> 折叠重复消息</label>
      <span id="meta"></span>
    </div>
    <div id="messages"></div>
  </section>
</main>
<script>
  var snapshot = {requests: []};
  var selectedId = null;
  var follow = true;
  var dedupe = true;
  var collapsed = {};
  var dupOpen = {};

  function esc(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function roleClass(r){ return ['system','user','assistant','tool'].indexOf(r) >= 0 ? r : 'other'; }
  function fmtTime(iso){ try { return new Date(iso).toLocaleTimeString(); } catch(e){ return ''; } }

  function currentRequest(){
    var reqs = snapshot.requests || [];
    if (!reqs.length) return null;
    if (follow || !selectedId) return reqs[reqs.length - 1];
    return reqs.find(function(r){ return r.id === selectedId; }) || reqs[reqs.length - 1];
  }

  function renderTurns(){
    var reqs = snapshot.requests || [];
    var cur = currentRequest();
    var el = document.getElementById('turns');
    el.innerHTML = reqs.map(function(r, gi){
      var active = cur && r.id === cur.id ? ' active' : '';
      var roles = {};
      r.messages.forEach(function(m){ roles[m.role] = (roles[m.role]||0)+1; });
      var chips = Object.keys(roles).map(function(k){ return '<span class="chip">'+k+'×'+roles[k]+'</span>'; }).join('');
      var hasResp = r.response && (r.response.reasoning || r.response.content);
      return '<div class="turn'+active+'" data-id="'+r.id+'">'
        + '<div class="t-title">请求 #'+(gi+1)+(hasResp ? ' <span class="chip">✓ 已回复</span>' : '')+'</div>'
        + '<div class="t-meta"><span>iter '+r.turn+'</span><span>'+r.messages.length+' msgs</span><span>'+fmtTime(r.at)+'</span></div>'
        + '<div class="t-meta">'+chips+'</div></div>';
    }).join('');
    Array.prototype.forEach.call(el.querySelectorAll('.turn'), function(node){
      node.addEventListener('click', function(){
        selectedId = node.getAttribute('data-id');
        follow = false;
        document.getElementById('follow').checked = false;
        render();
      });
    });
  }

  function renderMessages(){
    var cur = currentRequest();
    var box = document.getElementById('messages');
    var meta = document.getElementById('meta');
    if (!cur){ box.innerHTML = '<div class="empty">还没有发送给 LLM 的消息。发送一条消息后这里会实时显示。</div>'; meta.textContent=''; return; }

    var gi = (snapshot.requests || []).indexOf(cur);
    var messages = cur.messages || [];
    
    var html = '<div class="guide"><strong>💡 整个 Agent 的交互过程与执行流 (Agent Execution Flow)</strong><br>'
      + '下面是一个完整的、按时间顺序排列的 Agent 决策与执行流。它清晰地展示了：系统规则是什么、你输入了什么、Agent 进行了哪些思考与工具调用、工具返回了什么结果，以及最终 LLM 给出的答复。<br>'
      + '一次完整的 LLM 交互 = <span style="color:var(--system)">⚙️系统提示词</span> + <span style="color:var(--user)">👤用户输入</span> + <span style="color:var(--assistant)">🤖历史决策(思考/工具调用)</span> + <span style="color:var(--tool)">🔧工具运行结果</span> + <span style="color:var(--accent)">🎯本次 LLM 响应</span>。</div>';

    html += '<div class="timeline">';

    var seen = {};
    var dupCount = 0;

    messages.forEach(function(m, idx) {
      var key = cur.id + ':' + idx;
      
      // Check for duplicates
      var sig = m.role + '\\u0000' + m.content;
      var firstIdx = seen[sig];
      var isDup = firstIdx !== undefined;
      if (!isDup) seen[sig] = idx;
      
      if (isDup && dedupe && !dupOpen[key]) {
        dupCount++;
        var rc = roleClass(m.role);
        html += '<div class="dup" data-key="'+key+'" style="margin-left: 0;">⟳ '
          + '<span class="badge role-'+rc+'">'+esc(m.role)+'</span>'
          + '<span>#'+(idx+1)+' 与 #'+(firstIdx+1)+' 内容重复 · '+m.content.length+' chars · 点击展开</span></div>';
        return;
      }

      var isCol = collapsed[key] === undefined;
      // Default collapse system prompts or very long messages to keep it clean, but let user expand
      if (idx === 0 && m.role === 'system') {
        isCol = collapsed[key] === undefined ? true : collapsed[key];
      } else {
        isCol = collapsed[key] === undefined ? false : collapsed[key];
      }
      var colClass = isCol ? ' collapsed' : '';
      var rc = roleClass(m.role);

      var icon = '💬';
      var title = '';
      var desc = '';

      if (m.role === 'system') {
        icon = '⚙️';
        title = idx === 0 ? '系统提示词 (System Prompt)' : '系统引导提示 (System Hint)';
        desc = idx === 0 
          ? '这是本次会话的<strong>全局规则与工具协议</strong>。它定义了 Agent 能够调用的工具（如读写文件、运行命令等）以及它的行为规范。'
          : '系统自动追加的<strong>引导提示或协议校验信息</strong>，用来规范模型的下一次输出。';
      } else if (m.role === 'user') {
        icon = '👤';
        title = '用户输入 (User Input)';
        desc = '这是你发送给 Agent 的<strong>原始指令</strong>。所有历史里的用户指令都会作为上下文发送给模型。';
      } else if (m.role === 'assistant') {
        icon = '🤖';
        title = '历史决策与思考 (Assistant History)';
        desc = '模型在之前步骤中做出的<strong>分析与工具调用决策</strong>。它包含了思考过程（thinking）和具体的工具调用请求。';
      } else if (m.role === 'tool') {
        icon = '🔧';
        title = '工具运行结果 (Tool Result)';
        desc = '工具在你的<strong>本机环境实际运行后返回的结果</strong>。模型将读取这些结果来决定下一步怎么做。';
      }

      html += '<div class="t-step role-' + rc + '">'
        + '<span class="t-step-node">' + icon + '</span>'
        + '<div class="t-card' + colClass + '" data-key="' + key + '">'
        + '<div class="t-card-head"><span class="caret">▾</span>'
        + '<span class="badge">' + esc(m.role) + '</span>'
        + '<span class="title">#' + (idx + 1) + ' ' + title + '</span>'
        + '<span class="meta">' + m.content.length + ' chars</span>'
        + '<button class="copy" data-key="' + key + '" data-content-idx="' + idx + '">copy</button></div>'
        + '<div class="t-card-desc"><strong>[输入上下文 / Prompt Context]</strong> ' + desc + '</div>'
        + '<pre>' + esc(m.content) + '</pre>'
        + '</div></div>';
    });

    // 4. Render Current LLM Response (The final outcome of this call)
    var r = cur.response;
    var reasoning = r && r.reasoning ? r.reasoning : '';
    var answer = r && r.content ? r.content : '';

    if (reasoning || answer) {
      html += '<div class="t-step role-response">'
        + '<span class="t-step-node">🎯</span>'
        + '<div class="t-card reasoning" style="border-left: 3px solid var(--reasoning); margin-bottom: 12px;">'
        + '<div class="t-card-head"><span class="title">🧠 本次 LLM 思考过程 (Reasoning Chain)</span>'
        + '<span class="meta">' + reasoning.length + ' chars</span></div>'
        + '<div class="t-card-desc"><strong>[本次模型返回 / LLM Response]</strong> 模型在给出最终答复或调用新工具前的<strong>深度思考与推理过程</strong>。</div>'
        + '<pre>' + (reasoning ? esc(reasoning) : '(无思考内容)') + '</pre>'
        + '</div>'
        + '<div class="t-card answer" style="border-left: 3px solid var(--answer);">'
        + '<div class="t-card-head"><span class="title">✨ 本次 LLM 最终响应 (LLM Response)</span>'
        + '<span class="meta">' + answer.length + ' chars</span></div>'
        + '<div class="t-card-desc"><strong>[本次模型返回 / LLM Response]</strong> 模型本次输出的<strong>最终答复或新工具调用请求</strong>。</div>'
        + '<pre>' + (answer ? esc(answer) : '(无响应内容)') + '</pre>'
        + '</div>'
        + '</div>';
    } else {
      html += '<div class="t-step role-response">'
        + '<span class="t-step-node">⏳</span>'
        + '<div class="t-card collapsed">'
        + '<div class="t-card-head"><span class="title">等待 LLM 响应中...</span></div>'
        + '<div class="t-card-desc">正在等待模型返回推理与答复内容。</div>'
        + '</div></div>';
    }

    html += '</div>'; // End of timeline

    box.innerHTML = html;

    // Add event listeners for collapsibles
    Array.prototype.forEach.call(box.querySelectorAll('.t-card-head'), function(head){
      head.addEventListener('click', function(e){
        if (e.target && e.target.classList.contains('copy')) return;
        var card = head.parentNode;
        var key = card.getAttribute('data-key');
        if (!key) return;
        collapsed[key] = !collapsed[key];
        card.classList.toggle('collapsed');
      });
    });

    // Add event listeners for duplicates
    Array.prototype.forEach.call(box.querySelectorAll('.dup'), function(stub){
      stub.addEventListener('click', function(){
        dupOpen[stub.getAttribute('data-key')] = true; renderMessages();
      });
    });

    // Add event listeners for copies
    Array.prototype.forEach.call(box.querySelectorAll('.copy'), function(btn){
      btn.addEventListener('click', function(){
        var idx = parseInt(btn.getAttribute('data-content-idx'), 10);
        var c = currentRequest();
        if (!c) return;
        var content = c.messages[idx].content;
        navigator.clipboard.writeText(content).then(function(){
          btn.textContent = 'copied';
          setTimeout(function(){ btn.textContent = 'copy'; }, 1200);
        });
      });
    });

    meta.textContent = '请求 #' + (gi + 1) + ' · iter ' + cur.turn + ' · ' + cur.messages.length + ' 条消息'
      + (dupCount > 0 ? ' · 折叠 ' + dupCount + ' 条重复' : '') + ' · ' + fmtTime(cur.at);
  }

  function render(){
    document.getElementById('model').textContent = 'model ' + (snapshot.model || '—');
    renderTurns();
    renderMessages();
  }

  document.getElementById('follow').addEventListener('change', function(e){
    follow = e.target.checked; if (follow) selectedId = null; render();
  });
  document.getElementById('dedupe').addEventListener('change', function(e){
    dedupe = e.target.checked; if (dedupe) dupOpen = {}; renderMessages();
  });

  function connect(){
    var es = new EventSource('/events');
    var status = document.getElementById('status');
    var text = document.getElementById('status-text');
    es.addEventListener('open', function(){ status.classList.add('live'); text.textContent = 'live'; });
    es.addEventListener('error', function(){ status.classList.remove('live'); text.textContent = 'reconnecting…'; });
    es.addEventListener('snapshot', function(e){ snapshot = JSON.parse(e.data); render(); });
  }
  connect();
  render();
</script>
</body>
</html>`;
