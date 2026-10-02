import { useTranslation } from 'react-i18next';

import { connectChecked, type RosterItem } from '@/bridge/roster';
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
    const target = await connectChecked(item, () => true, async (url) => {
      const probe = await probeTlsFingerprint(url, item.fingerprint || null);
      return probe.ok && probe.fingerprint ? probe.fingerprint : null;
    });
    if ('error' in target || !item.mainSessionId) return;
    const config = bridgeStore.getConfig();
    const current = config?.servers.find((server) => server.id === config.activeServerId);
    const projectId = snapshot.projectId;
    if (!current || !projectId) return;
    const transport = inferTransport(target.url);
    const serverId = await bridgeStore.saveServer({
      label: target.label,
      serverUrl: target.url,
      token: current.token,
      fingerprint: target.fingerprint,
      transport: transport.transport,
      trust: 'pinned',
      serverKey: item.agentId
    });
    if (!serverId) return;
    await pinIndividualHome({
      serverId,
      projectId,
      agentId: item.agentId,
      mainSessionId: item.mainSessionId
    });
  };

  return (
    <Group title={t('mobile.settings.individuals', { defaultValue: '个体' })}>
      <IndividualPicker items={snapshot.roster} open={() => true} onPick={(item) => void pick(item)} />
    </Group>
  );
}
