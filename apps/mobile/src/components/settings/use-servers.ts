import { useCameraPermissions } from 'expo-camera';
import { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { inferTransport, loadBridgeConfig, type SavedServer } from '@/bridge/config';
import { formatCopy } from '@/bridge/copy';
import { parsePairingPayload } from '@/bridge/pairing';
import { bridgeStore } from '@/bridge/store';
import { useBridgeSnapshot } from '@/bridge/useBridge';
import { t as alertT } from '@/i18n/t';

export type FingerPrompt = { fingerprint: string; onSave: () => void; onReject?: () => void };

export type ServerDraft = { label: string; url: string; token: string; fingerprint: string };

const EMPTY_DRAFT: ServerDraft = { label: '', url: '', token: '', fingerprint: '' };

function transportFor(serverUrl: string, trust?: 'pinned' | 'public') {
  const inferred = inferTransport(serverUrl);
  const resolvedTrust = trust ?? inferred.trust;
  return { transport: resolvedTrust === 'public' ? ('cloudflare' as const) : inferred.transport, trust: resolvedTrust };
}

function hostOf(serverUrl: string): string {
  try {
    return new URL(serverUrl.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:')).hostname;
  } catch (error) {
    console.warn('[settings] pairing url has no parsable host', error);
    return '';
  }
}

/** Saved servers, the manual form, pairing and fingerprint prompts. */
export function useServers() {
  const snapshot = useBridgeSnapshot();
  const [permission, requestPermission] = useCameraPermissions();
  const [servers, setServers] = useState<SavedServer[]>([]);
  const [activeServerId, setActiveServerId] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ServerDraft>(EMPTY_DRAFT);
  const [testing, setTesting] = useState(false);
  const [finger, setFinger] = useState<FingerPrompt | null>(null);
  const shownPendingFp = useRef<string | null>(null);
  const scanLock = useRef(false);

  const refresh = async () => {
    const config = await loadBridgeConfig();
    setServers(config.servers);
    setActiveServerId(config.activeServerId);
  };

  useEffect(() => {
    void refresh();
  }, [snapshot.connection]);

  useEffect(() => {
    const pending = snapshot.pendingFingerprint;
    if (!pending) {
      shownPendingFp.current = null;
      return;
    }
    const key = `${pending.serverId}:${pending.fingerprint}`;
    if (shownPendingFp.current === key) return;
    shownPendingFp.current = key;
    setFinger({
      fingerprint: pending.fingerprint,
      onSave: () => void bridgeStore.confirmFingerprint(true).then(refresh),
      onReject: () => void bridgeStore.confirmFingerprint(false)
    });
  }, [snapshot.pendingFingerprint]);

  const clearDraft = () => {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
  };

  const probeInput = () => ({
    serverUrl: draft.url.trim(),
    token: draft.token.trim(),
    fingerprint: draft.fingerprint.trim() || undefined,
    trust: transportFor(draft.url.trim()).trust
  });

  const draftFilled = () => {
    if (draft.url.trim() && draft.token.trim()) return true;
    Alert.alert(alertT('mobile.settings.fillTitle'), alertT('mobile.settings.fillBody'));
    return false;
  };

  const persist = async (fingerprint?: string) => {
    await bridgeStore.saveServer({
      id: editingId ?? `srv-${Date.now()}`,
      serverUrl: draft.url.trim(),
      token: draft.token.trim(),
      label: draft.label.trim(),
      fingerprint: fingerprint ?? (draft.fingerprint.trim() || undefined),
      serverKey: undefined,
      ...transportFor(draft.url.trim())
    });
    clearDraft();
    setFormOpen(false);
    await refresh();
  };

  const scanned = async ({ data }: { data: string }) => {
    if (scanLock.current) return;
    scanLock.current = true;
    setScannerOpen(false);
    try {
      const payload = parsePairingPayload(data);
      if (!payload) {
        Alert.alert(alertT('mobile.settings.pairFailTitle'), alertT('mobile.settings.pairFailBody'));
        return;
      }
      const { transport, trust } = transportFor(payload.serverUrl, payload.trust);
      const probe = await bridgeStore.testConnection({
        serverUrl: payload.serverUrl,
        token: payload.token,
        fingerprint: payload.fingerprint ?? undefined,
        trust
      });
      const save = (fingerprint?: string) =>
        bridgeStore
          .saveServer({
            serverUrl: payload.serverUrl,
            token: payload.token,
            serverKey: payload.serverKey,
            label: hostOf(payload.serverUrl) || payload.serverUrl,
            fingerprint,
            transport,
            trust
          })
          .then(refresh);
      if (probe.ok) {
        if (probe.detail.code === 'confirmFingerprint' && probe.fingerprint) {
          const fingerprint = probe.fingerprint;
          setFinger({ fingerprint, onSave: () => void save(fingerprint) });
        } else {
          await save(payload.fingerprint ?? undefined);
          Alert.alert(
            alertT('mobile.settings.pairSuccessTitle'),
            alertT('mobile.settings.pairSuccessBody', { url: payload.serverUrl })
          );
        }
        return;
      }
      const code = probe.detail.code;
      const authish = code === 'authFailed' || code === 'urlExpired';
      Alert.alert(
        authish
          ? alertT(code === 'authFailed' ? 'mobile.pairing.pairAuthFailed' : 'mobile.pairing.pairUrlExpired')
          : alertT('mobile.settings.pairUnreachableTitle'),
        authish
          ? formatCopy(alertT, probe.detail)
          : alertT('mobile.settings.pairUnreachableBody', {
              url: payload.serverUrl,
              reason: formatCopy(alertT, probe.detail)
            })
      );
    } finally {
      scanLock.current = false;
    }
  };

  const openScanner = async () => {
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) {
        Alert.alert(alertT('mobile.settings.cameraTitle'), alertT('mobile.settings.cameraBody'));
        return;
      }
    }
    setScannerOpen(true);
  };

  const testDraft = async () => {
    if (!draftFilled()) return;
    setTesting(true);
    try {
      const result = await bridgeStore.testConnection(probeInput());
      if (result.detail.code === 'confirmFingerprint' && result.fingerprint) {
        const fingerprint = result.fingerprint;
        setFinger({
          fingerprint,
          onSave: () => {
            setDraft((d) => ({ ...d, fingerprint }));
            Alert.alert(alertT('mobile.settings.fingerprintSaved'), fingerprint);
          }
        });
        return;
      }
      Alert.alert(
        alertT(result.ok ? 'mobile.settings.testOkTitle' : 'mobile.settings.testFailTitle'),
        formatCopy(alertT, result.detail)
      );
    } finally {
      setTesting(false);
    }
  };

  const testServer = async (server: SavedServer) => {
    setTesting(true);
    try {
      const result = await bridgeStore.testConnection(server);
      if (result.detail.code === 'confirmFingerprint' && result.fingerprint) {
        const fingerprint = result.fingerprint;
        setFinger({
          fingerprint,
          onSave: () => void bridgeStore.saveServer({ ...server, fingerprint }).then(refresh)
        });
        return;
      }
      Alert.alert(
        alertT(result.ok ? 'mobile.settings.testOkTitle' : 'mobile.settings.testFailTitle'),
        formatCopy(alertT, result.detail)
      );
    } finally {
      setTesting(false);
    }
  };

  const saveDraft = async () => {
    if (!draftFilled()) return;
    setTesting(true);
    try {
      const result = await bridgeStore.testConnection(probeInput());
      if (result.detail.code === 'confirmFingerprint' && result.fingerprint) {
        const fingerprint = result.fingerprint;
        setFinger({ fingerprint, onSave: () => void persist(fingerprint) });
        return;
      }
      if (!result.ok) {
        Alert.alert(alertT('mobile.settings.testFailTitle'), formatCopy(alertT, result.detail));
        return;
      }
      await persist();
    } finally {
      setTesting(false);
    }
  };

  const remove = async (id: string) => {
    if (editingId === id) {
      clearDraft();
      setFormOpen(false);
    }
    await bridgeStore.deleteServer(id);
    await refresh();
  };

  const open = async (server: SavedServer) => {
    setEditingId(server.id);
    setDraft({ label: server.label, url: server.serverUrl, token: server.token, fingerprint: server.fingerprint ?? '' });
    setFormOpen(true);
    await bridgeStore.setActiveServer(server.id);
    await refresh();
  };

  const toggleForm = () => {
    if (formOpen && !editingId) {
      setFormOpen(false);
      return;
    }
    clearDraft();
    setFormOpen(true);
  };

  const answerFinger = (save: boolean) => {
    if (save) finger?.onSave();
    else finger?.onReject?.();
    setFinger(null);
  };

  return {
    servers,
    activeServerId,
    connected: snapshot.connection === 'open',
    scannerOpen,
    setScannerOpen,
    openScanner,
    scanned,
    formOpen,
    toggleForm,
    editingId,
    draft,
    setDraft,
    testing,
    testDraft,
    testServer,
    saveDraft,
    remove,
    open,
    finger,
    answerFinger
  };
}
