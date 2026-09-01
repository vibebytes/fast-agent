/** Same menu item, different picker: local dialog vs remote path tree. */
export async function openExistingFolder(): Promise<void> {
	const list = await window.fastIde.listEdges();
	if (list.pendingEdgeId) return;
	if (list.capabilities.canOpenRemoteFolder) {
		window.dispatchEvent(new CustomEvent('fast-ide:open-remote-folder'));
		return;
	}
	if (list.capabilities.canOpenLocalFolder) await window.fastIde.openProject();
}
