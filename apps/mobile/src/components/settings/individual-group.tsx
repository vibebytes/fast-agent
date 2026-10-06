import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';

import { openIndividual, type RosterItem } from '@/bridge/roster';
import { inferTransport } from '@/bridge/saved-server';
import { bridgeStore } from '@/bridge/store';
import { probeTlsFingerprint } from '@/bridge/tls-pinning';
import { pinIndividualHome } from '@/bridge/use-home';
import { useBridgeSnapshot } from '@/bridge/useBridge';
import { IndividualPicker } from './individual-picker';
import { Group } from './group';

/** Individuals from the connected server. Picking one checks its certificate and opens its main session. */
export function IndividualGroup() {
  const { t } = useTranslation();
  const snapshot = useBridgeSnapshot();
  if (snapshot.connection !== 'open' || snapshot.roster.length === 0) return null;

  const pick = async (item: RosterItem) => {
    const config = bridgeStore.getConfig();
    const current = config?.servers.find((server) => server.id === config.activeServerId);
    const projectId = snapshot.projectId;
    if (!current || !projectId) return;
    const result = await openIndividual(item, {
      open: () => true,
      probe: async (url) => {
        // Null pin so native returns the presented cert; JS compares in connectChecked.
        const probe = await probeTlsFingerprint(url, null);
        return probe.ok && probe.fingerprint ? probe.fingerprint : null;
      },
      save: async (target) => {
        if (!current) return false;
        const transport = inferTransport(target.url);
        const serverId = await bridgeStore.saveServer({
          label: target.label,
          serverUrl: target.url,
          token: item.token || current.token,
          fingerprint: target.fingerprint,
          transport: transport.transport,
          trust: 'pinned',
          serverKey: item.agentId
        });
        return Boolean(serverId);
      },
      pin: async (target, mainSessionId) => {
        if (!current || !projectId) return;
        const configAfter = bridgeStore.getConfig();
        const serverId =
          configAfter?.servers.find((server) => server.serverKey === item.agentId)?.id ??
          configAfter?.activeServerId;
        if (!serverId) return;
        await pinIndividualHome({
          serverId,
          projectId,
          agentId: target.agentId,
          mainSessionId
        });
      }
    });
    if (!result.ok) Alert.alert(result.error);
  };

  return (
    <Group title={t('mobile.settings.individuals', { defaultValue: '个体' })}>
      <IndividualPicker items={snapshot.roster} onPick={(item) => void pick(item)} />
    </Group>
  );
}
