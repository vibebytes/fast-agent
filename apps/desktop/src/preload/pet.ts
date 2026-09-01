import {contextBridge, ipcRenderer} from 'electron';

contextBridge.exposeInMainWorld('fastIdePet', {
	activate: (): void => {
		ipcRenderer.send('pet:activate');
	},
	moveTo: (screenX: number, screenY: number): void => {
		ipcRenderer.send('pet:move', screenX, screenY);
	},
	persistPosition: (): void => {
		ipcRenderer.send('pet:persist-position');
	},
	openContextMenu: (): void => {
		ipcRenderer.send('pet:context-menu');
	}
});
