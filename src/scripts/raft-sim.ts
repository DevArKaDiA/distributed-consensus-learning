// ─── Types ────────────────────────────────────────────────────────────────────

export type EventType =
  | 'election_timeout'
  | 'request_vote'
  | 'vote_granted'
  | 'vote_denied'
  | 'leader_elected'
  | 'heartbeat'
  | 'client_request'
  | 'append_entries'
  | 'append_ack'
  | 'entry_committed'
  | 'leader_crash'
  | 'node_recover';

export type ScenarioName = 'normal' | 'leader_crash' | 'partition' | 'split_vote';

export interface LogEntry {
  term: number;
  command: string;
  committed: boolean;
}

export interface NodeState {
  id: number;
  state: 'follower' | 'candidate' | 'leader' | 'dead';
  term: number;
  votedFor: number | null;
  log: LogEntry[];
  commitIndex: number;
}

export interface ClusterState {
  nodes: NodeState[];
  term: number;
}

export interface SimEvent {
  type: EventType;
  from?: number;
  to?: number;
  nodeId?: number;
  term?: number;
  logIndex?: number;
  command?: string;
  narration: { en: string; es: string };
  state: ClusterState;
  timestamp: number; // simulated ms
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cloneState(s: ClusterState): ClusterState {
  return {
    term: s.term,
    nodes: s.nodes.map(n => ({
      ...n,
      log: n.log.map(e => ({ ...e })),
    })),
  };
}

function initCluster(n = 5): ClusterState {
  return {
    term: 1,
    nodes: Array.from({ length: n }, (_, i) => ({
      id: i + 1,
      state: 'follower',
      term: 1,
      votedFor: null,
      log: [],
      commitIndex: -1,
    })),
  };
}

// ─── Scenario generators ──────────────────────────────────────────────────────

function normalOperation(nodeCount = 5): SimEvent[] {
  const events: SimEvent[] = [];
  let t = 0;
  const cluster = initCluster(nodeCount);
  const majority = Math.floor(nodeCount / 2) + 1;
  const allIds = cluster.nodes.map(n => n.id);

  const tick = (ms: number) => { t += ms; };

  // Helper to emit an event
  const emit = (
    type: EventType,
    fields: Partial<SimEvent>,
    en: string,
    es: string,
  ) => {
    events.push({
      type,
      ...fields,
      narration: { en, es },
      state: cloneState(cluster),
      timestamp: t,
    });
  };

  // 1. N3 times out
  tick(175);
  cluster.nodes[2].state = 'candidate';
  cluster.nodes[2].term = 2;
  cluster.nodes[2].votedFor = 3;
  cluster.term = 2;
  emit('election_timeout', { nodeId: 3, term: 2 },
    "N3's election timer expired after 175ms without hearing from a leader. It assumes the leader is gone and transitions to candidate, incrementing its term to 2.",
    "El temporizador de elección de N3 expiró tras 175ms sin recibir señal del líder. Asume que el líder ha desaparecido y pasa a candidato, incrementando su término a 2."
  );

  // 2. N3 sends RequestVote to N1
  tick(10);
  emit('request_vote', { from: 3, to: 1, term: 2 },
    "N3 asks N1 for its vote in term 2. It includes its log state so N1 can check whether N3 is at least as up-to-date.",
    "N3 pide el voto de N1 en el término 2. Incluye su estado de log para que N1 pueda verificar si N3 está tan actualizado como él."
  );

  // 3. N3 sends RequestVote to N2
  tick(10);
  emit('request_vote', { from: 3, to: 2, term: 2 },
    "N3 simultaneously asks N2 for its vote. Raft sends RequestVote RPCs in parallel to all peers.",
    "N3 pide el voto de N2 al mismo tiempo. Raft envía RPCs RequestVote en paralelo a todos los pares."
  );

  // 4. N1 grants vote
  tick(30);
  cluster.nodes[0].votedFor = 3;
  cluster.nodes[0].term = 2;
  emit('vote_granted', { from: 1, to: 3, term: 2 },
    "N1 grants its vote to N3 because: (1) it hasn't voted in term 2 yet, and (2) N3's log is at least as up-to-date as N1's. That's 2 votes for N3 (itself + N1).",
    "N1 concede su voto a N3 porque: (1) aún no ha votado en el término 2, y (2) el log de N3 está tan actualizado como el de N1. N3 ya tiene 2 votos (él mismo + N1)."
  );

  // 5. N2 grants vote
  tick(15);
  cluster.nodes[1].votedFor = 3;
  cluster.nodes[1].term = 2;
  emit('vote_granted', { from: 2, to: 3, term: 2 },
    "N2 also grants its vote. N3 now has 3 out of 5 votes — a strict majority (⌊5/2⌋ + 1 = 3). The election is won.",
    "N2 también concede su voto. N3 tiene ahora 3 de 5 votos — mayoría estricta (⌊5/2⌋ + 1 = 3). La elección está ganada."
  );

  // 6. N3 becomes leader
  tick(10);
  cluster.nodes[2].state = 'leader';
  emit('leader_elected', { nodeId: 3, term: 2 },
    "N3 wins the election with 3 votes — a majority. It immediately sends heartbeats to all followers to establish its authority and reset their election timers.",
    "N3 gana la elección con 3 votos — mayoría. Envía heartbeats a todos los seguidores inmediatamente para establecer su autoridad y reiniciar sus temporizadores."
  );

  // Update remaining nodes (only if they exist)
  if (cluster.nodes[3]) cluster.nodes[3].term = 2;
  if (cluster.nodes[4]) cluster.nodes[4].term = 2;

  // Heartbeats to all followers (all except N3 which is now leader)
  const followerIds = allIds.filter(id => id !== 3);
  for (const id of followerIds) {
    tick(20);
    emit('heartbeat', { from: 3, to: id, term: 2 },
      `N3 sends a heartbeat to N${id}. This resets N${id}'s election timer — it won't start a new election as long as heartbeats keep arriving within the timeout window.`,
      `N3 envía un heartbeat a N${id}. Esto reinicia el temporizador de N${id} — no iniciará una nueva elección mientras los heartbeats lleguen dentro del timeout.`
    );
  }

  // 11. Client sends command
  tick(200);
  const cmd1 = 'SET x=42';
  emit('client_request', { nodeId: 3, command: cmd1 },
    `A client sends the command "${cmd1}" to N3 (the leader). Only the leader accepts writes — followers redirect clients to the leader.`,
    `Un cliente envía el comando "${cmd1}" a N3 (el líder). Solo el líder acepta escrituras — los seguidores redirigen los clientes al líder.`
  );

  // AppendEntries to each follower
  cluster.nodes[2].log.push({ term: 2, command: cmd1, committed: false });
  for (const id of followerIds) {
    tick(15);
    cluster.nodes[id - 1].log.push({ term: 2, command: cmd1, committed: false });
    emit('append_entries', { from: 3, to: id, term: 2, command: cmd1, logIndex: 0 },
      `N3 sends AppendEntries to N${id} with the new entry "${cmd1}" at index 0. It also includes prevLogIndex=-1 and prevLogTerm=0 so N${id} can verify log consistency.`,
      `N3 envía AppendEntries a N${id} con la nueva entrada "${cmd1}" en el índice 0. Incluye prevLogIndex=-1 y prevLogTerm=0 para que N${id} pueda verificar la consistencia del log.`
    );
  }

  // ACKs from followers
  let acks = 0;
  for (const id of followerIds) {
    tick(20);
    acks++;
    emit('append_ack', { from: id, to: 3, term: 2, logIndex: 0 },
      `N${id} successfully appended the entry and sends an ACK back to N3. N3 now has ${acks + 1} ACKs (including itself). ${acks + 1 >= majority ? 'Majority reached!' : `Waiting for majority (need ${majority - acks - 1} more).`}`,
      `N${id} añadió la entrada correctamente y envía un ACK a N3. N3 tiene ahora ${acks + 1} ACKs (incluido él mismo). ${acks + 1 >= majority ? '¡Mayoría alcanzada!' : `Esperando mayoría (faltan ${majority - acks - 1}).`}`
    );
    if (acks + 1 === majority) {
      // Commit
      tick(10);
      for (const n of cluster.nodes) {
        n.log.forEach(e => { if (e.command === cmd1) e.committed = true; });
        n.commitIndex = 0;
      }
      emit('entry_committed', { nodeId: 3, command: cmd1, logIndex: 0, term: 2 },
        `A majority of nodes (${majority} out of ${nodeCount}) have written "${cmd1}" to their logs. N3 marks the entry as committed and applies it to its state machine.`,
        `La mayoría de nodos (${majority} de ${nodeCount}) han escrito "${cmd1}" en sus logs. N3 marca la entrada como confirmada y la aplica a su máquina de estado.`
      );
    }
  }

  // Second command
  tick(300);
  const cmd2 = 'SET y=7';
  emit('client_request', { nodeId: 3, command: cmd2 },
    `Another client request arrives: "${cmd2}". The leader appends it to its log and begins replication.`,
    `Llega otra petición de cliente: "${cmd2}". El líder la añade a su log e inicia la replicación.`
  );

  cluster.nodes[2].log.push({ term: 2, command: cmd2, committed: false });
  for (const id of followerIds) {
    tick(12);
    cluster.nodes[id - 1].log.push({ term: 2, command: cmd2, committed: false });
    emit('append_entries', { from: 3, to: id, term: 2, command: cmd2, logIndex: 1 },
      `N3 replicates "${cmd2}" to N${id} at log index 1. prevLogIndex=0 and prevLogTerm=2, matching N${id}'s log — consistency check passes.`,
      `N3 replica "${cmd2}" a N${id} en el índice 1. prevLogIndex=0 y prevLogTerm=2, coinciden con el log de N${id} — la verificación de consistencia pasa.`
    );
  }

  for (const id of followerIds) {
    tick(18);
    emit('append_ack', { from: id, to: 3, term: 2, logIndex: 1 },
      `N${id} ACKs the second entry. Replication is proceeding normally.`,
      `N${id} confirma la segunda entrada. La replicación continúa con normalidad.`
    );
  }

  tick(10);
  for (const n of cluster.nodes) {
    n.log.forEach(e => { if (e.command === cmd2) e.committed = true; });
    n.commitIndex = 1;
  }
  emit('entry_committed', { nodeId: 3, command: cmd2, logIndex: 1, term: 2 },
    `"${cmd2}" is committed. The cluster has now durably replicated two commands. The state machine on every live node reflects SET x=42 and SET y=7.`,
    `"${cmd2}" está confirmado. El cluster ha replicado de forma duradera dos comandos. La máquina de estado de cada nodo vivo refleja SET x=42 y SET y=7.`
  );

  return events;
}

function leaderCrashScenario(nodeCount = 5): SimEvent[] {
  const events: SimEvent[] = [];
  let t = 0;
  const cluster = initCluster(nodeCount);
  const majority = Math.floor(nodeCount / 2) + 1;
  const allIds = cluster.nodes.map(n => n.id);
  // Use nodes 1 as leader, N2 as candidate after crash (or last node if <4)
  const candidateIdx = Math.min(3, nodeCount - 1); // 0-based: node index 3 = N4, or last
  const candidateId = cluster.nodes[candidateIdx].id;

  const tick = (ms: number) => { t += ms; };
  const emit = (type: EventType, fields: Partial<SimEvent>, en: string, es: string) => {
    events.push({ type, ...fields, narration: { en, es }, state: cloneState(cluster), timestamp: t });
  };

  // Establish N1 as initial leader
  cluster.nodes[0].state = 'leader';
  cluster.nodes[0].term = 1;
  cluster.nodes[0].votedFor = 1;
  cluster.term = 1;
  for (const n of cluster.nodes) n.term = 1;

  emit('leader_elected', { nodeId: 1, term: 1 },
    "N1 is the established leader of term 1. The cluster is operating normally with regular heartbeats keeping followers in sync.",
    "N1 es el líder establecido del término 1. El cluster opera normalmente con heartbeats regulares que mantienen a los seguidores sincronizados."
  );

  // Replicate a command
  tick(150);
  const cmd = 'SET x=1';
  cluster.nodes[0].log.push({ term: 1, command: cmd, committed: false });
  emit('client_request', { nodeId: 1, command: cmd },
    `A client sends "${cmd}" to the leader N1. N1 appends it to its log and begins replication.`,
    `Un cliente envía "${cmd}" al líder N1. N1 lo añade a su log e inicia la replicación.`
  );

  const followerIds = allIds.filter(id => id !== 1);
  for (const id of followerIds) {
    tick(10);
    cluster.nodes[id - 1].log.push({ term: 1, command: cmd, committed: false });
    emit('append_entries', { from: 1, to: id, term: 1, command: cmd, logIndex: 0 },
      `N1 replicates "${cmd}" to N${id}.`,
      `N1 replica "${cmd}" a N${id}.`
    );
  }

  for (const n of cluster.nodes) {
    n.log.forEach(e => { e.committed = true; });
    n.commitIndex = 0;
  }
  tick(80);
  emit('entry_committed', { nodeId: 1, command: cmd, logIndex: 0, term: 1 },
    `"${cmd}" is committed — majority confirmed. The cluster state is consistent.`,
    `"${cmd}" está confirmado — la mayoría lo confirmó. El estado del cluster es consistente.`
  );

  // Leader crashes
  tick(200);
  cluster.nodes[0].state = 'dead';
  emit('leader_crash', { nodeId: 1 },
    "N1 has crashed unexpectedly. Followers will now wait for a heartbeat. After their election timeout expires (150–300ms with random jitter), one of them will start a new election.",
    "N1 ha caído inesperadamente. Los seguidores esperarán un heartbeat. Tras expirar su timeout de elección (150–300ms con jitter aleatorio), uno de ellos iniciará una nueva elección."
  );

  // candidateId times out first
  tick(210);
  cluster.nodes[candidateIdx].state = 'candidate';
  cluster.nodes[candidateIdx].term = 2;
  cluster.nodes[candidateIdx].votedFor = candidateId;
  cluster.term = 2;
  emit('election_timeout', { nodeId: candidateId, term: 2 },
    `N${candidateId}'s election timer fires first (randomized timeouts ensure only one node usually starts at a time). N${candidateId} increments its term to 2, votes for itself, and sends RequestVote to all live peers.`,
    `El temporizador de N${candidateId} expira primero. N${candidateId} incrementa su término a 2, se vota a sí mismo y envía RequestVote a todos los pares vivos.`
  );

  const voteTargets = followerIds.filter(id => id !== candidateId);
  for (const id of voteTargets) {
    tick(10);
    emit('request_vote', { from: candidateId, to: id, term: 2 },
      `N${candidateId} requests a vote from N${id}. Its log contains the committed entry, so it's at least as up-to-date.`,
      `N${candidateId} solicita el voto de N${id}. Su log contiene la entrada confirmada, por lo que está tan actualizado.`
    );
  }

  for (const id of voteTargets) {
    tick(25);
    cluster.nodes[id - 1].term = 2;
    cluster.nodes[id - 1].votedFor = candidateId;
    emit('vote_granted', { from: id, to: candidateId, term: 2 },
      `N${id} grants its vote to N${candidateId}. It updates its term to 2.`,
      `N${id} concede su voto a N${candidateId}. Actualiza su término a 2.`
    );
  }

  tick(20);
  cluster.nodes[candidateIdx].state = 'leader';
  emit('leader_elected', { nodeId: candidateId, term: 2 },
    `N${candidateId} wins the election. N1 is still dead. N${candidateId} immediately sends heartbeats to re-establish authority.`,
    `N${candidateId} gana la elección. N1 sigue caído. N${candidateId} envía heartbeats inmediatamente para restablecer su autoridad.`
  );

  for (const id of voteTargets) {
    tick(15);
    emit('heartbeat', { from: candidateId, to: id, term: 2 },
      `N${candidateId} sends a heartbeat to N${id} as new leader of term 2. The cluster is resilient — it lost one node but still has a majority and continues operating.`,
      `N${candidateId} envía un heartbeat a N${id} como nuevo líder del término 2. El cluster es resiliente — perdió un nodo pero aún tiene mayoría y continúa operando.`
    );
  }

  // N1 recovers
  tick(500);
  cluster.nodes[0].state = 'follower';
  cluster.nodes[0].term = 2;
  cluster.nodes[0].votedFor = null;
  emit('node_recover', { nodeId: 1 },
    "N1 has recovered and rejoins the cluster as a follower. It discovers the new term 2 from the first heartbeat it receives. Its log is already consistent, so no log repair is needed.",
    "N1 se ha recuperado y vuelve al cluster como seguidor. Descubre el nuevo término 2 en el primer heartbeat que recibe. Su log ya es consistente, por lo que no se necesita reparación de log."
  );

  return events;
}

function partitionScenario(nodeCount = 5): SimEvent[] {
  const events: SimEvent[] = [];
  let t = 0;
  const cluster = initCluster(nodeCount);
  const majority = Math.floor(nodeCount / 2) + 1;
  const allIds = cluster.nodes.map(n => n.id);
  // minority: N1 + N2, majority: rest (need at least 3 in majority)
  const minorityIds = allIds.slice(0, Math.max(1, nodeCount - majority));
  const majorityIds = allIds.filter(id => !minorityIds.includes(id));
  // new candidate is first of majority partition (not N1)
  const newCandidateId = majorityIds[0];
  const newCandidateIdx = newCandidateId - 1;

  const tick = (ms: number) => { t += ms; };
  const emit = (type: EventType, fields: Partial<SimEvent>, en: string, es: string) => {
    events.push({ type, ...fields, narration: { en, es }, state: cloneState(cluster), timestamp: t });
  };

  // Establish N1 as leader
  cluster.nodes[0].state = 'leader';
  cluster.term = 1;
  for (const n of cluster.nodes) n.term = 1;
  emit('leader_elected', { nodeId: 1, term: 1 },
    "N1 is the established leader. Cluster is operating normally.",
    "N1 es el líder establecido. El cluster opera con normalidad."
  );

  // Some log entries
  tick(100);
  const cmd = 'SET db=prod';
  cluster.nodes[0].log.push({ term: 1, command: cmd, committed: false });
  emit('client_request', { nodeId: 1, command: cmd },
    `Client sends "${cmd}". N1 begins replication.`,
    `El cliente envía "${cmd}". N1 inicia la replicación.`
  );
  for (const id of allIds.filter(id => id !== 1)) {
    tick(10);
    cluster.nodes[id - 1].log.push({ term: 1, command: cmd, committed: false });
    emit('append_entries', { from: 1, to: id, term: 1, command: cmd, logIndex: 0 },
      `N1 replicates to N${id}.`,
      `N1 replica a N${id}.`
    );
  }
  for (const n of cluster.nodes) { n.log.forEach(e => { e.committed = true; }); n.commitIndex = 0; }
  tick(60);
  emit('entry_committed', { nodeId: 1, command: cmd, logIndex: 0, term: 1 },
    `"${cmd}" committed successfully across the cluster.`,
    `"${cmd}" confirmado con éxito en el cluster.`
  );

  // Network partition
  tick(200);
  const minStr = minorityIds.map(id => `N${id}`).join(', ');
  const majStr = majorityIds.map(id => `N${id}`).join(', ');
  emit('leader_crash', { nodeId: 1 },
    `A network partition has occurred. ${minStr} are isolated in one partition, while ${majStr} form another. N1 still believes it's leader but cannot commit without a majority. The majority partition will elect a new leader.`,
    `Se ha producido una partición de red. ${minStr} están aislados, mientras que ${majStr} forman otra partición. N1 cree que sigue siendo líder pero no puede confirmar sin mayoría. La partición mayoritaria elegirá un nuevo líder.`
  );

  // newCandidateId times out (majority partition)
  tick(220);
  cluster.nodes[newCandidateIdx].state = 'candidate';
  cluster.nodes[newCandidateIdx].term = 2;
  cluster.nodes[newCandidateIdx].votedFor = newCandidateId;
  cluster.term = 2;
  emit('election_timeout', { nodeId: newCandidateId, term: 2 },
    `In the majority partition, N${newCandidateId}'s timer expires. It starts a new election in term 2. N1 is unreachable, so it cannot suppress this election.`,
    `En la partición mayoritaria, expira el temporizador de N${newCandidateId}. Inicia una nueva elección en el término 2. N1 no es alcanzable.`
  );

  const majVoters = majorityIds.filter(id => id !== newCandidateId);
  for (const id of majVoters) {
    tick(15);
    cluster.nodes[id - 1].term = 2;
    cluster.nodes[id - 1].votedFor = newCandidateId;
    emit('vote_granted', { from: id, to: newCandidateId, term: 2 },
      `N${id} grants its vote to N${newCandidateId}. With ${majorityIds.length} votes, N${newCandidateId} has a majority and wins the election.`,
      `N${id} concede su voto a N${newCandidateId}. Con ${majorityIds.length} votos, N${newCandidateId} tiene mayoría y gana la elección.`
    );
  }

  tick(20);
  cluster.nodes[newCandidateIdx].state = 'leader';
  emit('leader_elected', { nodeId: newCandidateId, term: 2 },
    `N${newCandidateId} is now the new legitimate leader in term 2. N1 is a stale leader in the minority partition. Any writes N1 accepts cannot be committed. Raft's safety is preserved.`,
    `N${newCandidateId} es ahora el nuevo líder legítimo en el término 2. N1 es un líder obsoleto en la partición minoritaria. La seguridad de Raft se mantiene.`
  );

  // newCandidateId accepts a write
  tick(150);
  const cmd2 = 'SET region=eu';
  cluster.nodes[newCandidateIdx].log.push({ term: 2, command: cmd2, committed: false });
  emit('client_request', { nodeId: newCandidateId, command: cmd2 },
    `Client (connected to the majority partition) sends "${cmd2}" to N${newCandidateId}. It replicates to the majority partition.`,
    `El cliente (conectado a la partición mayoritaria) envía "${cmd2}" a N${newCandidateId}. Lo replica en la partición mayoritaria.`
  );

  for (const id of majVoters) {
    tick(12);
    cluster.nodes[id - 1].log.push({ term: 2, command: cmd2, committed: false });
    emit('append_entries', { from: newCandidateId, to: id, term: 2, command: cmd2, logIndex: 1 },
      `N${newCandidateId} replicates "${cmd2}" to N${id} (majority partition only).`,
      `N${newCandidateId} replica "${cmd2}" a N${id} (solo partición mayoritaria).`
    );
  }

  for (const id of majorityIds) {
    cluster.nodes[id - 1].log.forEach(e => { if (e.command === cmd2) e.committed = true; });
    cluster.nodes[id - 1].commitIndex = 1;
  }
  tick(40);
  emit('entry_committed', { nodeId: newCandidateId, command: cmd2, logIndex: 1, term: 2 },
    `"${cmd2}" is committed — a majority of the full cluster confirmed it. N1's isolated writes never committed, so there's no conflict.`,
    `"${cmd2}" está confirmado — la mayoría del cluster completo lo confirmó. Las escrituras aisladas de N1 nunca se confirmaron.`
  );

  // Partition heals
  tick(400);
  cluster.nodes[0].state = 'follower';
  cluster.nodes[0].term = 2;
  for (const id of minorityIds) cluster.nodes[id - 1].term = 2;
  emit('node_recover', { nodeId: 1 },
    `The network partition heals. N1 receives a heartbeat from N${newCandidateId} with term 2 > term 1. N1 immediately steps down and becomes a follower. Its uncommitted log entries are overwritten to match the authoritative log.`,
    `La partición de red se repara. N1 recibe un heartbeat de N${newCandidateId} con término 2 > término 1. N1 inmediatamente cede el liderazgo y se convierte en seguidor.`
  );

  return events;
}

function splitVoteScenario(nodeCount = 5): SimEvent[] {
  const events: SimEvent[] = [];
  let t = 0;
  const cluster = initCluster(nodeCount);

  const tick = (ms: number) => { t += ms; };
  const emit = (type: EventType, fields: Partial<SimEvent>, en: string, es: string) => {
    events.push({ type, ...fields, narration: { en, es }, state: cloneState(cluster), timestamp: t });
  };

  // Start with all followers
  cluster.term = 1;
  for (const n of cluster.nodes) n.term = 1;
  emit('election_timeout', { nodeId: 0, term: 1 },
    "No leader exists. All nodes are followers waiting for an election. Their election timers are running simultaneously — a split vote is about to happen because two nodes have nearly identical timeouts.",
    "No hay líder. Todos los nodos son seguidores esperando una elección. Sus temporizadores corren simultáneamente — está a punto de producirse un voto dividido porque dos nodos tienen timeouts casi idénticos."
  );

  // N2 and N4 start elections at nearly the same time
  tick(150);
  cluster.nodes[1].state = 'candidate';
  cluster.nodes[1].term = 2;
  cluster.nodes[1].votedFor = 2;
  cluster.term = 2;
  emit('election_timeout', { nodeId: 2, term: 2 },
    "N2's timer fires at 150ms. It becomes a candidate for term 2 and sends RequestVote to N1, N3, N4, N5.",
    "El temporizador de N2 expira a los 150ms. Se convierte en candidato para el término 2 y envía RequestVote a N1, N3, N4, N5."
  );

  tick(5); // Almost simultaneous
  cluster.nodes[3].state = 'candidate';
  cluster.nodes[3].term = 2;
  cluster.nodes[3].votedFor = 4;
  emit('election_timeout', { nodeId: 4, term: 2 },
    "Just 5ms later, N4's timer also fires. It becomes a candidate for the same term 2. Two candidates are now competing simultaneously — a split vote scenario.",
    "Solo 5ms después, el temporizador de N4 también expira. Se convierte en candidato para el mismo término 2. Dos candidatos compiten simultáneamente — un escenario de voto dividido."
  );

  // N2 sends vote requests
  for (const id of [1, 3]) {
    tick(8);
    emit('request_vote', { from: 2, to: id, term: 2 },
      `N2 requests a vote from N${id}. N2's message arrives before N4's.`,
      `N2 solicita el voto de N${id}. El mensaje de N2 llega antes que el de N4.`
    );
  }

  // N4 sends vote requests
  for (const id of [5]) {
    tick(8);
    emit('request_vote', { from: 4, to: id, term: 2 },
      `N4 requests a vote from N5. N4's message arrives before N2's.`,
      `N4 solicita el voto de N5. El mensaje de N4 llega antes que el de N2.`
    );
  }

  // N1 votes for N2 (received N2's request first)
  tick(20);
  cluster.nodes[0].votedFor = 2;
  cluster.nodes[0].term = 2;
  emit('vote_granted', { from: 1, to: 2, term: 2 },
    "N1 votes for N2 — it received N2's request first and hasn't voted yet in term 2.",
    "N1 vota por N2 — recibió la solicitud de N2 primero y aún no ha votado en el término 2."
  );

  // N3 votes for N2
  tick(10);
  cluster.nodes[2].votedFor = 2;
  cluster.nodes[2].term = 2;
  emit('vote_granted', { from: 3, to: 2, term: 2 },
    "N3 also votes for N2. N2 now has 3 votes: itself + N1 + N3. But wait — N4 also needs votes.",
    "N3 también vota por N2. N2 tiene ahora 3 votos: él mismo + N1 + N3. Pero N4 también necesita votos."
  );

  // N5 votes for N4
  tick(15);
  cluster.nodes[4].votedFor = 4;
  cluster.nodes[4].term = 2;
  emit('vote_granted', { from: 5, to: 4, term: 2 },
    "N5 votes for N4 — it received N4's request first. N4 has 2 votes so far (itself + N5), not yet a majority.",
    "N5 vota por N4 — recibió la solicitud de N4 primero. N4 tiene 2 votos hasta ahora (él mismo + N5), aún no es mayoría."
  );

  // N4 requests N1, N3 — but they already voted for N2
  tick(15);
  emit('vote_denied', { from: 1, to: 4, term: 2 },
    "N4 asks N1 for a vote, but N1 already voted for N2 in term 2. Vote denied — each node gets exactly one vote per term.",
    "N4 le pide el voto a N1, pero N1 ya votó por N2 en el término 2. Voto denegado — cada nodo tiene exactamente un voto por término."
  );

  tick(10);
  emit('vote_denied', { from: 3, to: 4, term: 2 },
    "N4 asks N3 — also denied. N3 already voted for N2. N4 cannot win this election. N2 wins with 3 votes: N2 + N1 + N3.",
    "N4 le pide a N3 — también denegado. N3 ya votó por N2. N4 no puede ganar esta elección. N2 gana con 3 votos: N2 + N1 + N3."
  );

  // N2 wins
  tick(10);
  cluster.nodes[1].state = 'leader';
  cluster.nodes[3].state = 'follower'; // N4 steps down
  emit('leader_elected', { nodeId: 2, term: 2 },
    "N2 wins the election with 3 votes (majority). N4 receives a heartbeat from N2 with a matching or higher term and steps down to follower. The split vote resolved because only N2 reached a strict majority first.",
    "N2 gana la elección con 3 votos (mayoría). N4 recibe un heartbeat de N2 con término igual o mayor y pasa a seguidor. El voto dividido se resolvió porque solo N2 alcanzó la mayoría estricta primero."
  );

  // Heartbeats
  for (const id of [1, 3, 4, 5]) {
    tick(15);
    emit('heartbeat', { from: 2, to: id, term: 2 },
      `N2 sends heartbeat to N${id}, establishing its authority. N4 accepts this as it has not yet won any election.`,
      `N2 envía heartbeat a N${id}, estableciendo su autoridad. N4 lo acepta ya que no ha ganado ninguna elección.`
    );
  }

  // Note: If it had been a true split (e.g. 2-2 with 1 uncommitted), the scenario would retry
  tick(50);
  emit('election_timeout', { nodeId: 0, term: 2 },
    "In a true split vote (when votes tie and no one reaches majority), all candidates time out and restart in a new term with fresh random timeouts. The randomization ensures the deadlock resolves quickly.",
    "En un verdadero voto dividido (cuando los votos empatan y nadie alcanza la mayoría), todos los candidatos agotan su tiempo y reinician en un nuevo término con timeouts aleatorios frescos. La aleatorización asegura que el bloqueo se resuelve rápidamente."
  );

  return events;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function generateScenario(name: ScenarioName, nodeCount = 5): SimEvent[] {
  const n = Math.max(3, Math.min(9, nodeCount));
  switch (name) {
    case 'normal':       return normalOperation(n);
    case 'leader_crash': return leaderCrashScenario(n);
    case 'partition':    return partitionScenario(n);
    case 'split_vote':   return splitVoteScenario(n);
    default:             return normalOperation(n);
  }
}
