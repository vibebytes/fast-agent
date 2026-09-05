import {
  applyBridgeEvent,
  applyLeaseExpiry,
  applyLocalCancel,
  CANCEL_SETTLEMENT_TIMEOUT_MS,
  RUN_LEASE_INTERVAL_MS,
  RUN_LEASE_TTL_MS,
  composerGate,
  createTranscriptState,
  emptySessionSeq,
  offer,
  seqTerminal,
  type GoalCardView,
  type SessionSeq,
  type TranscriptState
} from '@fast-ide/session-view';
import {isSessionStreamEvent, PROTOCOL_MISMATCH_PREFIX, type BridgeCommand, type BridgeEvent} from '@fastllm/bridge-protocol';

import {BridgeClient, type ConnectionState, type ParseStats} from './client';
import {
  foldUserEchoes,
  goalCardFromUpdated,
  goalKeepsBusy,
  type UserEcho
} from './mobile-transcript';
import {
  activeServer,
  loadBridgeConfig,
  newServerId,
  saveBridgeConfig,
  toClientConfig,
  type BridgeConfig,
  type SavedServer
} from './config';
import {applyCodeChangeEvent, createCodeChangesState, type CodeChangesState} from './codeChanges';
import type { Copy } from './copy';
import { rawError } from './copy';
import {bridgeUrlIssue, normalizeBridgeUrl} from './pairing';
import {openPinnedSocket} from './pinned-socket';
import {probeTlsFingerprint} from './tls-pinning';
import {wsFrameText} from './wsFrame';

export type SessionSummary = {
  id: string;
  title: string;
  summary: string | null;
  lastModified: string;
  messageCount: number;
  runMode: string | null;
};

export type ProjectSummary = {
  id: string;
  name: string;
  path: string;
  workspaceId: string | null;
  isDefault: boolean;
};

export type FollowUpItem = {id: string; text: string};

export type FollowUpsState = {
  paused: boolean;
  items: FollowUpItem[];
};

export type SessionRecord = {
  sessionId: string;
  transcript: TranscriptState;
  codeChanges: CodeChangesState;
  lastEventSeq: number;
  /** Mobile-local Goal card from `goal_updated` (not in shared transcript projection). */
  goalCard?: GoalCardView;
};

export type StoreSnapshot = {
  connection: ConnectionState;
  connectionDetail: Copy | null;
  projectId: string | null;
  projects: ProjectSummary[];
  sessions: SessionSummary[];
  sessionsByProject: Record<string, SessionSummary[]>;
  sessionsLoaded: boolean;
  records: Record<string, SessionRecord>;
  followUps: Record<string, FollowUpsState>;
  lastSessionId: string | null;
  pendingFingerprint: {serverId: string; fingerprint: string} | null;
  /** Catalog key shown once after lease TTL locally settles a stuck run. */
  leaseNotice: string | null;
  /** Host-level diagnostic from `host_error` (not session-scoped). */
  hostNotice: string | null;
  parseStats: ParseStats;
};

function mergeSessions(current: SessionSummary[], incoming: SessionSummary[]): SessionSummary[] {
  const byId = new Map(incoming.map((s) => [s.id, s]));
  for (const s of current) {
    if (!byId.has(s.id)) byId.set(s.id, s);
  }
  return [...byId.values()];
}

function sessionIdFromEvent(event: BridgeEvent): string | undefined {
  if ('sessionId' in event && typeof event.sessionId === 'string') return event.sessionId;
  return undefined;
}

function parseFollowUps(itemsJson: string): FollowUpItem[] {
  try {
    const parsed = JSON.parse(itemsJson) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((it): it is Record<string, unknown> => typeof it === 'object' && it !== null)
      .map((it, i) => ({
        id: typeof it.id === 'string' ? it.id : `item-${i}`,
        text: typeof it.text === 'string' ? it.text : typeof it.title === 'string' ? it.title : ''
      }))
      .filter((it) => it.text);
  } catch {
    return [];
  }
}

class BridgeStore {
  private createWaiters = new Map<
    string,
    {resolve: (sessionId: string | null) => void; timer: ReturnType<typeof setTimeout>}
  >();
  private client: BridgeClient | null = null;
  private config: BridgeConfig | null = null;
  private listeners = new Set<() => void>();
  private records = new Map<string, SessionRecord>();
  private seqBySession = new Map<string, SessionSeq>();
  private attached = new Set<string>();
  private loadingOlder = new Set<string>();
  /** Per-session cancel-settle watchdog. Not a singleton — switching sessions must not clobber another. */
  private cancelSettleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private leaseSeenAt = new Map<string, number>();
  private leaseReconcileAt = new Map<string, number>();
  private leaseScanTimer: ReturnType<typeof setInterval> | null = null;
  /** Optimistic user rows, keyed by session, kept until a real user row replaces them. */
  private echoes = new Map<string, UserEcho[]>();
  private snapshot: StoreSnapshot = {
    connection: 'idle',
    connectionDetail: null,
    projectId: null,
    projects: [],
    sessions: [],
    sessionsByProject: {},
    sessionsLoaded: false,
    records: {},
    followUps: {},
    lastSessionId: null,
    pendingFingerprint: null,
    leaseNotice: null,
    hostNotice: null,
    parseStats: {parseFailures: 0, deadLetters: []}
  };

  private boot: Promise<void> | null = null;

  async start(): Promise<void> {
    if (this.boot) return this.boot;
    this.boot = this.bootClient().catch(error => {
      this.boot = null;
      throw error;
    });
    return this.boot;
  }

  private async bootClient(): Promise<void> {
    this.config = await loadBridgeConfig();
    this.snapshot = {
      ...this.snapshot,
      lastSessionId: await this.loadLastSessionId()
    };
    this.client = new BridgeClient(toClientConfig(this.config), {
      onState: (connection, detail) => {
        this.snapshot = {...this.snapshot, connection, connectionDetail: detail ?? null};
        this.emit();
      },
      onEvent: event => this.handleEvent(event),
      onOpen: () => this.onOpen(),
      onTerminalParseFailure: message => {
        if (message.startsWith(PROTOCOL_MISMATCH_PREFIX)) {
          this.snapshot = {...this.snapshot, hostNotice: message};
        }
        for (const sessionId of this.attached) this.sendAttach(sessionId);
        this.emit();
      },
      onDeadLetter: () => {
        const stats = this.client?.stats();
        if (!stats) return;
        this.snapshot = {...this.snapshot, parseStats: stats};
        this.emit();
      },
      onUnpinnedFingerprint: fingerprint => {
        const serverId = this.config?.activeServerId;
        if (!serverId) return;
        this.snapshot = {...this.snapshot, pendingFingerprint: {serverId, fingerprint}};
        this.emit();
      }
    });
    this.client.connect();
  }

  async confirmFingerprint(pin: boolean): Promise<void> {
    const pending = this.snapshot.pendingFingerprint;
    this.snapshot = {...this.snapshot, pendingFingerprint: null};
    if (pin && pending && this.config) {
      this.config = {
        ...this.config,
        servers: this.config.servers.map((s) =>
          s.id === pending.serverId ? {...s, fingerprint: pending.fingerprint} : s
        )
      };
      await saveBridgeConfig(this.config);
      this.emit();
      this.client?.updateConfig(toClientConfig(this.config));
      return;
    }
    this.emit();
  }

  async saveServer(input: Omit<SavedServer, 'id'> & {id?: string}): Promise<string> {
    await this.start();
    if (!this.config) return '';
    const id = input.id ?? newServerId();
    const exists = this.config.servers.some((s) => s.id === id);
    const server: SavedServer = {
      id,
      label: input.label,
      serverUrl: normalizeBridgeUrl(input.serverUrl),
      token: input.token,
      fingerprint: input.fingerprint
    };
    this.config = {
      ...this.config,
      servers: exists
        ? this.config.servers.map((s) => (s.id === id ? server : s))
        : [...this.config.servers, server],
      activeServerId: id
    };
    await saveBridgeConfig(this.config);
    this.reconnectIfActive(id);
    return id;
  }

  async deleteServer(id: string): Promise<void> {
    if (!this.config) return;
    const servers = this.config.servers.filter((s) => s.id !== id);
    const activeServerId = this.config.activeServerId === id ? (servers[0]?.id ?? null) : this.config.activeServerId;
    this.config = {...this.config, servers, activeServerId};
    await saveBridgeConfig(this.config);
    this.reconnectIfActive(id);
  }

  async setActiveServer(id: string): Promise<void> {
    if (!this.config) return;
    if (!this.config.servers.some((s) => s.id === id)) return;
    this.config = {...this.config, activeServerId: id};
    await saveBridgeConfig(this.config);
    this.reconnectIfActive(id);
  }

  private reconnectIfActive(id: string) {
    if (this.config?.activeServerId === id) {
      this.client?.updateConfig(toClientConfig(this.config));
    }
  }

  async testConnection(server: {serverUrl: string; token: string; fingerprint?: string}): Promise<{ok: boolean; detail: Copy; fingerprint?: string}> {
    await this.start();
    const serverUrl = normalizeBridgeUrl(server.serverUrl);
    const issue = bridgeUrlIssue(serverUrl);
    if (issue) return {ok: false, detail: issue};
    const live = this.client;
    live?.close();
    try {
      if (serverUrl.startsWith('wss://')) {
        const probe = await probeTlsFingerprint(serverUrl, server.fingerprint ?? null);
        if (!probe.ok) return {ok: false, detail: probe.detail};
        if (!server.fingerprint) {
          return {ok: false, detail: { code: 'confirmFingerprint', fingerprint: probe.fingerprint }, fingerprint: probe.fingerprint};
        }
        return await this.testPinned(serverUrl, server.token, server.fingerprint);
      }
      return await this.testPlain(serverUrl, server.token);
    } finally {
      if (live && this.config) live.updateConfig(toClientConfig(this.config));
    }
  }

  private helloLine(token: string): string {
    return JSON.stringify({
      type: 'Hello',
      protocolVersion: 1,
      clientId: `probe-${Date.now().toString(36)}`,
      clientKind: 'fast-mobile',
      clientVersion: '0.1.0',
      authToken: token || undefined
    });
  }

  private finishHello(
    data: string,
    finish: (ok: boolean, detail: Copy) => void
  ): void {
    try {
      const event = JSON.parse(data) as {type?: string; message?: string};
      if (event.type === 'HelloOk') finish(true, { code: 'helloOk' });
      else if (event.type === 'HelloReject') {
        finish(false, event.message ? { code: 'raw', text: event.message } : { code: 'helloReject' });
      }
    } catch {
      // ignore
    }
  }

  private async testPinned(serverUrl: string, token: string, fingerprint: string): Promise<{ok: boolean; detail: Copy}> {
    return new Promise((resolve) => {
      let settled = false;
      let wire: {close: () => void} | null = null;
      const finish = (ok: boolean, detail: Copy) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          wire?.close();
        } catch {
          // already closed
        }
        resolve({ok, detail});
      };
      const timer = setTimeout(() => finish(false, { code: 'timeout' }), 8000);
      void openPinnedSocket(serverUrl, fingerprint, {
        onOpen: () => undefined,
        onMessage: (data) => this.finishHello(data, finish),
        onError: () => finish(false, { code: 'cannotConnect' }),
        onClose: () => {
          if (!settled) finish(false, { code: 'cannotConnect' });
        }
      })
        .then((opened) => {
          wire = opened;
          if (!opened.send(this.helloLine(token))) finish(false, { code: 'cannotConnect' });
        })
        .catch((error) => finish(false, rawError(error)));
    });
  }

  private testPlain(serverUrl: string, token: string): Promise<{ok: boolean; detail: Copy}> {
    return new Promise((resolve) => {
      let settled = false;
      let socket: WebSocket;
      const finish = (ok: boolean, detail: Copy) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          socket.close();
        } catch {
          // already closed
        }
        resolve({ok, detail});
      };
      try {
        socket = new WebSocket(serverUrl);
      } catch (error) {
        return resolve({ok: false, detail: rawError(error)});
      }
      const timer = setTimeout(() => finish(false, { code: 'timeout' }), 8000);
      socket.onopen = () => {
        socket.send(this.helloLine(token));
      };
      socket.onmessage = (raw) => {
        const text = wsFrameText(raw.data);
        if (text) this.finishHello(text, finish);
      };
      socket.onerror = () => finish(false, { code: 'cannotConnect' });
    });
  }

  getConfig(): BridgeConfig | null {
    return this.config;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): StoreSnapshot => this.snapshot;

  attach(sessionId: string) {
    this.attached.add(sessionId);
    const record = this.ensureRecord(sessionId);
    if (record.transcript.awaitingCancelSettlement && !this.cancelSettleTimers.has(sessionId)) {
      this.armCancelSettleTimer(sessionId);
    }
    this.sendAttach(sessionId);
    if (this.snapshot.lastSessionId !== sessionId) {
      this.snapshot = {...this.snapshot, lastSessionId: sessionId};
      void this.saveLastSessionId(sessionId);
    }
  }

  detach(sessionId: string) {
    this.attached.delete(sessionId);
    this.clearCancelSettleTimer(sessionId);
    this.leaseSeenAt.delete(sessionId);
    this.leaseReconcileAt.delete(sessionId);
  }

  resyncSession(sessionId: string) {
    if (!this.snapshot.records[sessionId]) return;
    this.sendAttach(sessionId);
  }

  createSession(title?: string): Promise<string | null> {
    const projectId = this.snapshot.projectId;
    if (!projectId || this.snapshot.connection !== 'open') return Promise.resolve(null);
    const project = this.snapshot.projects.find((p) => p.id === projectId);
    const taskId = `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const sent = this.send({
      type: 'CreateSession',
      projectId,
      taskId,
      ...(title?.trim() ? {title: title.trim()} : {}),
      ...(project?.workspaceId ? {workspaceId: project.workspaceId} : {})
    });
    if (!sent) return Promise.resolve(null);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.createWaiters.delete(taskId);
        resolve(null);
      }, 8000);
      this.createWaiters.set(taskId, {resolve, timer});
    });
  }

  setProject(projectId: string) {
    if (!this.snapshot.projects.some((p) => p.id === projectId)) return;
    const sessions = this.snapshot.sessionsByProject[projectId] ?? [];
    this.snapshot = {...this.snapshot, projectId, sessions};
    this.emit();
  }

  private settleCreate(event: Extract<BridgeEvent, {type: 'command_result'}>) {
    const taskId = event.taskId;
    if (!taskId) return;
    const waiter = this.createWaiters.get(taskId);
    if (!waiter) return;
    this.createWaiters.delete(taskId);
    clearTimeout(waiter.timer);
    const accepted = event.status === 'accepted' || event.status === 'success';
    const sessionId = event.sessionId;
    if (!accepted || !sessionId) {
      waiter.resolve(null);
      return;
    }
    this.prependSession({
      id: sessionId,
      title: event.title?.trim() || '',
      summary: null,
      lastModified: new Date().toISOString(),
      messageCount: 0,
      runMode: null
    });
    this.attach(sessionId);
    waiter.resolve(sessionId);
    this.send({type: 'GetWorkspaceMeta'});
  }

  private prependSession(session: SessionSummary) {
    const projectId = this.snapshot.projectId;
    const sessions = [session, ...this.snapshot.sessions.filter((s) => s.id !== session.id)];
    const byProject = projectId
      ? {
          ...this.snapshot.sessionsByProject,
          [projectId]: [session, ...(this.snapshot.sessionsByProject[projectId] ?? []).filter((s) => s.id !== session.id)]
        }
      : this.snapshot.sessionsByProject;
    this.snapshot = {...this.snapshot, sessions, sessionsByProject: byProject};
    this.emit();
  }

  composerRunState(sessionId: string): string {
    const record = this.records.get(sessionId);
    if (!record) return 'idle';
    return composerGate(record.transcript, false).runState;
  }

  sendUserMessage(
    sessionId: string,
    text: string,
    opts?: {clientMessageId?: string; generateTitle?: boolean}
  ): {sent: boolean; clientMessageId: string} {
    const clientMessageId = opts?.clientMessageId ?? `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const sent = this.send({
      type: 'SubmitUserMessage',
      sessionId,
      text,
      clientMessageId,
      generateTitle: opts?.generateTitle
    });
    if (sent) {
      this.rememberUserEcho(sessionId, clientMessageId, text);
      if (this.snapshot.leaseNotice || this.snapshot.hostNotice) {
        this.snapshot = {...this.snapshot, leaseNotice: null, hostNotice: null};
      }
    }
    return {sent, clientMessageId};
  }

  decideApproval(sessionId: string, approvalId: string, approved: boolean): boolean {
    const record = this.records.get(sessionId);
    const approval = record?.transcript.approvals.find((a) => a.id === approvalId);
    if (!approval) return false;
    return this.send({
      type: 'DecideApproval',
      sessionId,
      runId: approval.runId,
      approvalId,
      approved
    });
  }

  answerQuestion(sessionId: string, questionId: string, answer: string): boolean {
    const record = this.records.get(sessionId);
    const question = record?.transcript.questions.find((q) => q.id === questionId);
    if (!question) return false;
    return this.send({
      type: 'AnswerQuestion',
      sessionId,
      runId: question.runId,
      questionId,
      answer
    });
  }

  answerQuestionBatch(
    sessionId: string,
    rpcId: string,
    payload: {answers: Array<{id: string; selected: string[]; custom?: string}>} | {cancelled: true}
  ): boolean {
    const record = this.records.get(sessionId);
    const batch = record?.transcript.questionBatches.find((q) => q.rpcId === rpcId);
    if (!batch) return false;
    if ('cancelled' in payload && payload.cancelled) {
      return this.send({type: 'AnswerQuestionBatch', sessionId, rpcId, cancelled: true});
    }
    if (!('answers' in payload) || payload.answers.length === 0) return false;
    return this.send({
      type: 'AnswerQuestionBatch',
      sessionId,
      rpcId,
      answers: payload.answers
    });
  }

  interruptWithMessage(sessionId: string, text: string): boolean {
    return this.send({
      type: 'InterruptWithMessage',
      sessionId,
      text,
      clientMessageId: `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    });
  }

  cancelRun(sessionId: string, runId?: string): boolean {
    const record = this.ensureRecord(sessionId);
    const id = (runId ?? record.transcript.activeRunId)?.trim();
    const sent = id
      ? this.send({type: 'CancelRun', sessionId, runId: id, reason: 'user-cancel'})
      : this.send({type: 'CancelAssociated', sessionId, reason: 'user-cancel'});
    if (!sent) return false;
    record.transcript = applyLocalCancel(record.transcript);
    this.armCancelSettleTimer(sessionId);
    this.publishRecords();
    return true;
  }

  cancelGoal(sessionId: string, goalId?: string): boolean {
    const id = goalId?.trim() || this.records.get(sessionId)?.goalCard?.goalId;
    if (!id) return false;
    return this.send({type: 'CancelGoal', goalId: id});
  }

  rerunRun(sessionId: string, runId: string): boolean {
    const id = runId.trim();
    if (!id) return false;
    return this.send({type: 'RerunRun', sessionId, runId: id});
  }

  continueRun(sessionId: string): boolean {
    return this.sendUserMessage(sessionId, 'continue').sent;
  }

  interruptAndSay(sessionId: string, text: string): boolean {
    return this.interruptWithMessage(sessionId, text);
  }

  cancelSession(sessionId: string): boolean {
    return this.send({type: 'CancelSession', sessionId, reason: 'user_cancelled'});
  }

  killProc(sessionId: string, procId: string): boolean {
    return this.send({type: 'KillProc', sessionId, procId, reason: 'user_kill'});
  }

  followUpRemove(sessionId: string, itemId: string): boolean {
    return this.send({type: 'FollowUpRemove', sessionId, itemId});
  }

  followUpUpdate(sessionId: string, itemId: string, text: string): boolean {
    return this.send({type: 'FollowUpUpdate', sessionId, itemId, text});
  }

  followUpReorder(sessionId: string, fromIndex: number, toIndex: number): boolean {
    return this.send({type: 'FollowUpReorder', sessionId, fromIndex, toIndex});
  }

  followUpPause(sessionId: string, paused: boolean): boolean {
    return this.send({type: 'FollowUpPause', sessionId, paused});
  }

  loadOlder(sessionId: string): boolean {
    const record = this.records.get(sessionId);
    if (!record || this.loadingOlder.has(sessionId)) return false;
    if (record.transcript.hasMoreOlder === false) return false;
    const oldest = record.transcript.entries.find((e) => e.turnId);
    if (!oldest?.turnId) return false;
    this.loadingOlder.add(sessionId);
    return this.send({type: 'FetchSessionHistory', sessionId, beforeTurnId: oldest.turnId, limit: 30});
  }

  private async loadLastSessionId(): Promise<string | null> {
    const {storageGet} = await import('./safe-storage');
    return storageGet('fast.lastSessionId');
  }

  private async saveLastSessionId(sessionId: string): Promise<void> {
    const {storageSet} = await import('./safe-storage');
    await storageSet('fast.lastSessionId', sessionId);
  }

  private onOpen() {
    this.send({type: 'GetWorkspaceMeta'});
    for (const sessionId of this.attached) this.sendAttach(sessionId);
  }

  private sendAttach(sessionId: string) {
    const record = this.records.get(sessionId);
    this.send({
      type: 'AttachSession',
      sessionId,
      lastEventSeq: record?.lastEventSeq ?? 0,
      clientId: this.config?.clientId ?? ''
    });
  }

  private send(command: BridgeCommand): boolean {
    return this.client?.send(command) ?? false;
  }

  private ensureRecord(sessionId: string): SessionRecord {
    let record = this.records.get(sessionId);
    if (!record) {
      record = {
        sessionId,
        transcript: createTranscriptState(),
        codeChanges: createCodeChangesState(),
        lastEventSeq: 0
      };
      this.records.set(sessionId, record);
    }
    return record;
  }

  private handleEvent(event: BridgeEvent) {
    if (event.type === 'host_error') {
      this.snapshot = {...this.snapshot, hostNotice: event.message};
      this.emit();
      return;
    }
    if (event.type === 'workspace_meta') {
      const seen = new Set<string>();
      const projects: ProjectSummary[] = [];
      for (const p of event.projects) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        const path = p.workspace?.rootPath ?? p.id;
        projects.push({
          id: p.id,
          name: p.displayName ?? path.split('/').pop() ?? path,
          path,
          workspaceId: p.workspace?.pathHash ?? p.workspace?.id ?? null,
          isDefault: p.isDefault
        });
      }
      const sessionsByProject: Record<string, SessionSummary[]> = {};
      for (const project of projects) {
        sessionsByProject[project.id] = Object.values(event.sessionsByProjectId[project.id] ?? {}).map((s) => ({
          id: s.id,
          title: s.title ?? '',
          summary: null,
          lastModified: s.updatedAt ?? '',
          messageCount: 0,
          runMode: null
        }));
      }
      const projectId =
        this.snapshot.projectId ??
        projects.find((p) => p.isDefault)?.id ??
        projects[0]?.id ??
        null;
      const incoming = projectId ? (sessionsByProject[projectId] ?? []) : [];
      this.snapshot = {
        ...this.snapshot,
        projects,
        sessionsByProject,
        sessionsLoaded: true,
        projectId,
        sessions: mergeSessions(this.snapshot.projectId === projectId ? this.snapshot.sessions : [], incoming)
      };
      this.emit();
      return;
    }
    if (event.type === 'sessions_list') {
      const incoming = event.sessions.map((s) => ({
        id: s.id,
        title: s.title?.trim() || s.summary?.trim() || '',
        summary: s.summary?.trim() || null,
        lastModified: s.lastModified,
        messageCount: s.messageCount,
        runMode: s.runMode ?? null
      }));
      this.snapshot = {
        ...this.snapshot,
        sessionsLoaded: true,
        sessions: mergeSessions(this.snapshot.sessions, incoming)
      };
      this.emit();
      return;
    }
    if (event.type === 'command_result' && (event.name === 'CreateSession' || event.name === 'NewSession')) {
      this.settleCreate(event);
      return;
    }
    if (event.type === 'command_result' && event.name === 'CancelGoal') {
      this.clearGoalCard(sessionIdFromEvent(event) ?? this.snapshot.lastSessionId);
      return;
    }
    if (event.type === 'session_restored') {
      this.send({type: 'GetWorkspaceMeta'});
    }
    const sessionId = sessionIdFromEvent(event);
    if (!sessionId) return;
    if (isSessionStreamEvent(event.type) && !this.attached.has(sessionId)) return;
    this.applyToSession(sessionId, event);
  }

  private applyToSession(sessionId: string, event: BridgeEvent) {
    const record = this.ensureRecord(sessionId);
    const prevTranscript = record.transcript;
    const prevCode = record.codeChanges;
    const prevGoal = record.goalCard;
    const prevFollow = this.snapshot.followUps[sessionId];
    const before = this.seqBySession.get(sessionId) ?? {
      ...emptySessionSeq(),
      lastApplied: record.lastEventSeq
    };
    const result = offer(before, event, {terminal: seqTerminal(record.transcript)});
    this.seqBySession.set(sessionId, result.state);
    if (result.state.lastApplied !== before.lastApplied) {
      record.lastEventSeq = result.state.lastApplied;
      this.send({
        type: 'Ack',
        sessionId,
        clientId: this.config?.clientId ?? '',
        lastEventSeq: result.state.lastApplied
      });
    }
    for (const ev of result.emit) {
      record.transcript = applyBridgeEvent(record.transcript, ev);
      record.codeChanges = applyCodeChangeEvent(record.codeChanges, ev);
      if (ev.type === 'goal_updated') record.goalCard = goalCardFromUpdated(ev);
      if (ev.type === 'session_history_page') this.loadingOlder.delete(sessionId);
      if (
        ev.type === 'turn_cancelled' ||
        ev.type === 'run_cancelled' ||
        ev.type === 'turn_finished' ||
        ev.type === 'run_done' ||
        ev.type === 'run_failed' ||
        ev.type === 'run_exhausted'
      ) {
        this.clearCancelSettleTimer(sessionId);
        this.noteRunLease(sessionId, record, ev.type);
      }
      if (ev.type === 'run_state') this.noteRunLease(sessionId, record, ev.type);
      if (ev.type === 'follow_up_changed') {
        this.snapshot = {
          ...this.snapshot,
          followUps: {
            ...this.snapshot.followUps,
            [sessionId]: {paused: ev.paused, items: parseFollowUps(ev.itemsJson)}
          }
        };
      }
    }
    this.foldEchoes(sessionId, record);
    if (!record.transcript.awaitingCancelSettlement) this.clearCancelSettleTimer(sessionId);
    if (result.resync) this.sendAttach(sessionId);
    const sameUi =
      record.transcript === prevTranscript &&
      record.codeChanges === prevCode &&
      record.goalCard === prevGoal &&
      this.snapshot.followUps[sessionId] === prevFollow;
    if (!sameUi) this.publishRecords();
  }

  private rememberUserEcho(sessionId: string, clientMessageId: string, text: string) {
    const pending = this.echoes.get(sessionId) ?? [];
    if (!pending.some((e) => e.clientMessageId === clientMessageId)) {
      pending.push({clientMessageId, text});
      this.echoes.set(sessionId, pending);
    }
    const record = this.ensureRecord(sessionId);
    this.foldEchoes(sessionId, record);
    this.publishRecords();
  }

  private foldEchoes(sessionId: string, record: SessionRecord) {
    const folded = foldUserEchoes(record.transcript.entries, this.echoes.get(sessionId) ?? []);
    this.echoes.set(sessionId, folded.pending);
    if (folded.entries !== record.transcript.entries) {
      record.transcript = {...record.transcript, entries: folded.entries};
    }
  }

  private noteRunLease(sessionId: string, record: SessionRecord, _type: string) {
    this.leaseSeenAt.set(sessionId, Date.now());
    this.leaseReconcileAt.delete(sessionId);
    if (record.transcript.leaseAware) this.ensureLeaseScan();
  }

  private ensureLeaseScan() {
    if (this.leaseScanTimer != null) return;
    this.leaseScanTimer = setInterval(() => this.tickRunLeases(), 2_000);
    const timer = this.leaseScanTimer as ReturnType<typeof setInterval> & {unref?: () => void};
    timer.unref?.();
  }

  private hasLocalRun(t: TranscriptState): boolean {
    return Boolean(t.activeRunId) || t.entries.some(e => e.status === 'streaming');
  }

  private leaseBusy(record: SessionRecord): boolean {
    return this.hasLocalRun(record.transcript) || goalKeepsBusy(record.goalCard);
  }

  tickRunLeases() {
    const now = Date.now();
    let changed = false;
    for (const [sessionId, record] of this.records) {
      if (!this.attached.has(sessionId)) continue;
      if (!record.transcript.leaseAware || !this.leaseBusy(record)) {
        this.leaseReconcileAt.delete(sessionId);
        continue;
      }
      const reconcileAt = this.leaseReconcileAt.get(sessionId);
      if (reconcileAt != null) {
        if (now - reconcileAt < RUN_LEASE_INTERVAL_MS) continue;
        record.transcript = applyLeaseExpiry(record.transcript);
        if (goalKeepsBusy(record.goalCard)) record.goalCard = undefined;
        this.leaseReconcileAt.delete(sessionId);
        this.snapshot = {...this.snapshot, leaseNotice: 'errors.lease.expired'};
        changed = true;
        continue;
      }
      const seen = this.leaseSeenAt.get(sessionId);
      if (seen == null || now - seen <= RUN_LEASE_TTL_MS) continue;
      this.sendAttach(sessionId);
      this.leaseReconcileAt.set(sessionId, now);
    }
    if (changed) this.publishRecords();
  }

  consumeLeaseNotice(): string | null {
    const note = this.snapshot.leaseNotice;
    if (note) this.snapshot = {...this.snapshot, leaseNotice: null};
    return note;
  }

  private armCancelSettleTimer(sessionId: string) {
    this.clearCancelSettleTimer(sessionId);
    this.cancelSettleTimers.set(
      sessionId,
      setTimeout(() => {
        this.cancelSettleTimers.delete(sessionId);
        this.forceCancelSettlement(sessionId);
      }, CANCEL_SETTLEMENT_TIMEOUT_MS)
    );
  }

  private clearCancelSettleTimer(sessionId: string) {
    const timer = this.cancelSettleTimers.get(sessionId);
    if (timer == null) return;
    clearTimeout(timer);
    this.cancelSettleTimers.delete(sessionId);
  }

  /** 12s watchdog: applyLocalCancel then settle so activeRunId actually clears. */
  private forceCancelSettlement(sessionId: string) {
    const record = this.records.get(sessionId);
    if (!record?.transcript.awaitingCancelSettlement) return;
    record.transcript = applyBridgeEvent(applyLocalCancel(record.transcript), {
      type: 'turn_cancelled',
      reason: 'client settlement timeout'
    });
    this.publishRecords();
  }

  private clearGoalCard(sessionId: string | null) {
    if (!sessionId) return;
    const record = this.records.get(sessionId);
    if (!record?.goalCard) return;
    record.goalCard = undefined;
    this.publishRecords();
  }

  private publishRecords() {
    this.snapshot = {
      ...this.snapshot,
      records: Object.fromEntries(this.records)
    };
    this.emit();
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }
}

export const bridgeStore = new BridgeStore();
