# Distributed Consensus Learning

An interactive, bilingual (EN/ES) educational site about the **Raft consensus algorithm** — built with Astro 6 and Tailwind v4.

Live at → **https://devarkadiA.github.io/distributed-consensus-learning**

---

## What's inside

| Page | Description |
|------|-------------|
| **The Problem** | Why distributed consensus is hard |
| **Raft** | Core algorithm: leader election, log replication, safety |
| **In the Wild** | How Raft is used in etcd, CockroachDB, TiKV, Consul |
| **Implementation** | Key theoretical components and how they're built |
| **Resources** | Papers, talks, and further reading |
| **Visualizer** | Live interactive Raft cluster simulation |

### Visualizer features

- Live cluster (5 nodes by default, 3–9 configurable) with real election timers and heartbeats
- Add / remove nodes with realistic join sequence: learner → catch-up → InstallSnapshot (if compacted) → voter
- **KV Store terminal** — `set`, `get`, `del`, `keys`, `state` against the live cluster; reads and writes are animated as packets
- **Cluster Admin shell** — `kill`, `revive`, `partition`, `heal`, `compact`, `status`, `quorum`, `logs`
- **Log compaction / snapshots** — auto-compacts after 8 committed entries; `[snapshot @N]` visible in node detail panel
- Command history (↑/↓) in both terminals
- Node detail panel showing state, term, votedFor, commitIndex, and full log per node

---

## Development

```bash
npm install
npm run dev        # localhost:4321
npm run build      # production build → ./dist/
npm run preview    # preview the build locally
```

Requires Node.js ≥ 22.

---

## Tech stack

- [Astro 6](https://astro.build) — static site generator with i18n routing
- [Tailwind v4](https://tailwindcss.com) via `@tailwindcss/vite`
- [anime.js v4](https://animejs.com) — packet trail animations (`waapi.animate`)
- Deployed to GitHub Pages via `.github/workflows/deploy.yml`

---

## Acknowledgements

- [In Search of an Understandable Consensus Algorithm](https://raft.github.io/raft.pdf) — Ongaro & Ousterhout (2014)
- [Raftscope](https://github.com/ongardie/raftscope) — interactive visualization by Diego Ongaro
- [raft.github.io](https://raft.github.io) — canonical reference
- [etcd documentation](https://etcd.io/docs/)
- [MIT 6.824 Distributed Systems](https://pdos.csail.mit.edu/6.824/)
