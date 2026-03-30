import { waapi, createTimeline, stagger } from 'animejs';

// ─── Types ────────────────────────────────────────────────────────────────────

type NodeState = 'follower' | 'candidate' | 'leader' | 'dead';

interface NodeData {
  id: number;
  state: NodeState;
  term: number;
  x: number;
  y: number;
  el: SVGGElement | null;
  circle: SVGCircleElement | null;
  label: SVGTextElement | null;
}

interface ClusterConfig {
  id: string;
  nodeCount: number;
  showKill: boolean;
  showSendCmd: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const COLOR: Record<NodeState, string> = {
  follower:  '#6366f1',
  candidate: '#10b981',
  leader:    '#f59e0b',
  dead:      '#374151',
};

const FILL_ALPHA: Record<NodeState, string> = {
  follower:  '#6366f118',
  candidate: '#10b98118',
  leader:    '#f59e0b22',
  dead:      '#37415108',
};

const COMMANDS = ['SET x=1', 'SET y=42', 'DEL z', 'SET name=raft', 'INCR counter', 'SET ok=true'];

const R = 28; // node radius
const SVG_W = 600;

// ─── Layout helpers ───────────────────────────────────────────────────────────

function circlePositions(n: number, cx: number, cy: number, r: number) {
  return Array.from({ length: n }, (_, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  });
}

// ─── SVG helpers ──────────────────────────────────────────────────────────────

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

// ─── Cluster class ────────────────────────────────────────────────────────────

class RaftCluster {
  id: string;
  nodes: NodeData[] = [];
  animating = false;
  cmdIdx = 0;
  logEntries: { cmd: string; committed: boolean }[] = [];

  svgEl!: SVGSVGElement;
  edgesG!: SVGGElement;
  nodesG!: SVGGElement;
  packetsG!: SVGGElement;
  logEl!: HTMLElement;
  svgH!: number;

  constructor(cfg: ClusterConfig) {
    this.id = cfg.id;
    this.svgEl = document.getElementById(`svg-${cfg.id}`) as SVGSVGElement;
    this.edgesG = document.getElementById(`edges-${cfg.id}`) as SVGGElement;
    this.nodesG = document.getElementById(`nodes-${cfg.id}`) as SVGGElement;
    this.packetsG = document.getElementById(`packets-${cfg.id}`) as SVGGElement;
    this.logEl = document.getElementById(`log-${cfg.id}`) as HTMLElement;
    this.svgH = parseInt(this.svgEl.getAttribute('height') || '320');

    this.init(cfg.nodeCount);
    this.bindButtons(cfg);
  }

  init(n: number) {
    this.nodes = [];
    this.logEntries = [];
    this.animating = false;
    this.cmdIdx = 0;
    this.edgesG.innerHTML = '';
    this.nodesG.innerHTML = '';
    this.packetsG.innerHTML = '';
    if (this.logEl) this.logEl.innerHTML = '';

    const cx = SVG_W / 2;
    const cy = this.svgH / 2;
    const radius = Math.min(cx, cy) - R - 20;
    const positions = circlePositions(n, cx, cy, radius);

    this.nodes = positions.map((pos, i) => ({
      id: i + 1,
      state: 'follower' as NodeState,
      term: 1,
      x: pos.x,
      y: pos.y,
      el: null,
      circle: null,
      label: null,
    }));

    this.drawEdges();
    this.drawNodes();
  }

  drawEdges() {
    this.edgesG.innerHTML = '';
    const alive = this.nodes.filter(n => n.state !== 'dead');
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i], b = alive[j];
        const line = svgEl('line', {
          x1: a.x, y1: a.y, x2: b.x, y2: b.y,
          stroke: '#1e293b', 'stroke-width': 1.5,
          id: `edge-${this.id}-${a.id}-${b.id}`,
        });
        this.edgesG.appendChild(line);
      }
    }
  }

  drawNodes() {
    this.nodesG.innerHTML = '';
    this.nodes.forEach(n => {
      const g = svgEl('g', { id: `node-${this.id}-${n.id}`, style: 'cursor:default' });

      // glow ring (visible only for leader)
      const glow = svgEl('circle', {
        cx: n.x, cy: n.y, r: R + 8,
        fill: 'none', stroke: COLOR[n.state],
        'stroke-width': 2, opacity: n.state === 'leader' ? 0.4 : 0,
        id: `glow-${this.id}-${n.id}`,
      });

      const circle = svgEl('circle', {
        cx: n.x, cy: n.y, r: R,
        fill: FILL_ALPHA[n.state],
        stroke: COLOR[n.state], 'stroke-width': 2,
        id: `circle-${this.id}-${n.id}`,
      });

      const label = svgEl('text', {
        x: n.x, y: n.y - 4,
        'text-anchor': 'middle',
        fill: COLOR[n.state],
        'font-size': 11, 'font-family': 'JetBrains Mono, monospace',
        'font-weight': 'bold',
      });
      label.textContent = `N${n.id}`;

      const sublabel = svgEl('text', {
        x: n.x, y: n.y + 10,
        'text-anchor': 'middle',
        fill: '#64748b',
        'font-size': 9, 'font-family': 'JetBrains Mono, monospace',
        id: `sub-${this.id}-${n.id}`,
      });
      sublabel.textContent = n.state;

      const termLabel = svgEl('text', {
        x: n.x, y: n.y + 22,
        'text-anchor': 'middle',
        fill: '#475569',
        'font-size': 8, 'font-family': 'JetBrains Mono, monospace',
        id: `term-${this.id}-${n.id}`,
      });
      termLabel.textContent = `t${n.term}`;

      g.appendChild(glow);
      g.appendChild(circle);
      g.appendChild(label);
      g.appendChild(sublabel);
      g.appendChild(termLabel);
      this.nodesG.appendChild(g);

      n.el = g;
      n.circle = circle;
    });
  }

  updateNode(node: NodeData) {
    const circle = document.getElementById(`circle-${this.id}-${node.id}`) as SVGCircleElement | null;
    const glow = document.getElementById(`glow-${this.id}-${node.id}`) as SVGCircleElement | null;
    const sub = document.getElementById(`sub-${this.id}-${node.id}`) as SVGTextElement | null;
    const term = document.getElementById(`term-${this.id}-${node.id}`) as SVGTextElement | null;

    if (circle) {
      circle.setAttribute('stroke', COLOR[node.state]);
      circle.setAttribute('fill', FILL_ALPHA[node.state]);
    }
    if (glow) {
      glow.setAttribute('stroke', COLOR[node.state]);
      waapi.animate(glow, { opacity: node.state === 'leader' ? 0.5 : 0, duration: 400 });
    }
    if (sub) { sub.setAttribute('fill', '#64748b'); sub.textContent = node.state; }
    if (term) { term.textContent = `t${node.term}`; }
  }

  flashNode(node: NodeData, color: string) {
    const circle = document.getElementById(`circle-${this.id}-${node.id}`) as SVGCircleElement | null;
    if (!circle) return;
    waapi.animate(circle, {
      scale: [1, 1.18, 1],
      duration: 350,
      ease: 'out(3)',
    });
  }

  sendPacket(from: NodeData, to: NodeData, color = '#38bdf8', onDone?: () => void) {
    const packet = svgEl('circle', {
      cx: from.x, cy: from.y, r: 5,
      fill: color, opacity: 0.9,
    });
    this.packetsG.appendChild(packet);

    waapi.animate(packet, {
      cx: to.x, cy: to.y,
      duration: 380,
      ease: 'inOut(2)',
      onComplete: () => {
        packet.remove();
        onDone?.();
      },
    });
  }

  log(msg: string) {
    if (!this.logEl) return;
    const line = document.createElement('div');
    line.textContent = `> ${msg}`;
    line.style.opacity = '0';
    this.logEl.appendChild(line);
    waapi.animate(line, { opacity: 1, duration: 200 });
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  clearLog() {
    if (this.logEl) this.logEl.innerHTML = '';
  }

  // ── Actions ──────────────────────────────────────────────────────────────────

  async runElection() {
    if (this.animating) return;
    this.animating = true;
    this.clearLog();

    const alive = this.nodes.filter(n => n.state !== 'dead');
    if (alive.length < 2) { this.animating = false; return; }

    // demote previous leader
    this.nodes.forEach(n => { if (n.state === 'leader') { n.state = 'follower'; this.updateNode(n); } });

    const cand = alive[Math.floor(Math.random() * alive.length)];
    cand.state = 'candidate';
    cand.term++;
    this.updateNode(cand);
    this.flashNode(cand, COLOR.candidate);
    this.log(`N${cand.id} timed out → candidate (term ${cand.term})`);

    await sleep(500);

    // send RequestVote to each peer
    let votes = 1;
    const others = alive.filter(n => n.id !== cand.id);

    for (const peer of others) {
      await sleep(120);
      this.sendPacket(cand, peer, COLOR.candidate);
      await sleep(380);
      votes++;
      this.log(`N${peer.id} voted ✓  [${votes}/${alive.length}]`);
      this.sendPacket(peer, cand, '#10b981');
      await sleep(200);
    }

    await sleep(300);

    cand.state = 'leader';
    this.updateNode(cand);
    this.flashNode(cand, COLOR.leader);
    this.log(`✓ N${cand.id} is leader (term ${cand.term})`);

    // send heartbeats
    await sleep(200);
    for (const peer of others) {
      this.sendPacket(cand, peer, COLOR.leader);
      await sleep(80);
    }
    this.log(`♥ heartbeats sent to all followers`);

    this.animating = false;
  }

  killLeader() {
    const leader = this.nodes.find(n => n.state === 'leader');
    if (!leader) { this.log('No leader to kill — run an election first.'); return; }
    leader.state = 'dead';
    this.updateNode(leader);
    this.drawEdges();
    this.log(`N${leader.id} crashed 💀 — followers will timeout`);
  }

  async sendCommand() {
    if (this.animating) return;
    const leader = this.nodes.find(n => n.state === 'leader');
    if (!leader) { this.log('No leader — run an election first.'); return; }

    this.animating = true;
    const cmd = COMMANDS[this.cmdIdx++ % COMMANDS.length];
    const followers = this.nodes.filter(n => n.state === 'follower');

    this.log(`client → "${cmd}"`);
    await sleep(300);
    this.log(`[1/3] Leader appends to log, replicating...`);

    for (const f of followers) {
      this.sendPacket(leader, f, COLOR.leader);
      await sleep(100);
    }
    await sleep(500);
    this.log(`[2/3] Majority ACK'd — committing...`);

    for (const f of followers) {
      this.sendPacket(f, leader, '#94a3b8');
      await sleep(60);
    }
    await sleep(400);
    this.log(`[3/3] ✓ "${cmd}" committed & applied`);

    this.animating = false;
  }

  reset(n?: number) {
    this.init(n ?? this.nodes.length);
    this.log('cluster reset');
  }

  bindButtons(cfg: ClusterConfig) {
    document.querySelectorAll(`[data-cluster="${cfg.id}"][data-action]`).forEach(btn => {
      btn.addEventListener('click', () => {
        const action = (btn as HTMLElement).dataset.action;
        if (action === 'election') this.runElection();
        else if (action === 'kill') this.killLeader();
        else if (action === 'send') this.sendCommand();
        else if (action === 'reset') this.reset();
      });
    });
  }
}

// ─── Sleep util ───────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ─── Auto-init all clusters on the page ──────────────────────────────────────

export function initClusters() {
  document.querySelectorAll<SVGSVGElement>('svg[data-cluster]').forEach(svg => {
    const id = svg.dataset.cluster!;
    const nodeCount = parseInt(svg.dataset.nodeCount || '5');
    const container = svg.closest('[data-cluster-root]') as HTMLElement | null;
    const showKill = !!container?.querySelector(`[data-action="kill"]`);
    const showSendCmd = !!container?.querySelector(`[data-action="send"]`);
    new RaftCluster({ id, nodeCount, showKill, showSendCmd });
  });
}
