import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {defineConfig, externalizeDepsPlugin} from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const require = createRequire(import.meta.url);
// CJS default export
const monacoEditorPlugin = require('vite-plugin-monaco-editor').default as (
	options?: Record<string, unknown>
) => import('vite').Plugin;

const uiRoot = resolve(__dirname, '../../packages/web/ui');
const sessionViewRoot = resolve(__dirname, '../../packages/core/session-view');
const i18nRoot = resolve(__dirname, '../../packages/core/i18n');
/** Pin to built dist so Vite never serves a stale prebundle missing new exports. */
const bridgeProtocolDist = resolve(__dirname, '../../packages/core/bridge/protocol/dist/index.js');
const bridgeClientRoot = resolve(__dirname, '../../packages/core/bridge/client');

export default defineConfig({
	main: {
		// Bundle workspace TS packages — Node cannot load their .ts sources as ESM.
		plugins: [
			externalizeDepsPlugin({
				exclude: [
					'@fast-ide/session-view',
					'@fast-ide/i18n',
					'@fastllm/bridge-protocol',
					'@fastllm/bridge-client',
					'i18next',
					// Packaged asar has no node_modules — leave `ws` in the main bundle.
					'ws'
				]
			})
		],
		resolve: {
			alias: {
				'@fast-ide/session-view': resolve(sessionViewRoot, 'src/index.ts'),
				'@fast-ide/i18n/locales': resolve(i18nRoot, 'locales'),
				'@fast-ide/i18n/browser': resolve(i18nRoot, 'src/browser.ts'),
				'@fast-ide/i18n': resolve(i18nRoot, 'src/index.ts'),
				'@fastllm/bridge-client': resolve(bridgeClientRoot, 'src/index.ts'),
				'@fastllm/bridge-protocol': bridgeProtocolDist
			}
		},
		build: {
			rollupOptions: {
				input: {
					index: resolve('src/main/index.ts')
				},
				external: ['bufferutil', 'utf-8-validate']
			}
		}
	},
	preload: {
		plugins: [externalizeDepsPlugin({exclude: ['@fast-ide/session-view', '@fastllm/bridge-protocol']})],
		resolve: {
			alias: {
				'@fastllm/bridge-protocol': bridgeProtocolDist
			}
		},
		build: {
			rollupOptions: {
				input: {
					index: resolve('src/preload/index.ts'),
					pet: resolve('src/preload/pet.ts')
				}
			}
		}
	},
	renderer: {
		root: resolve('src/renderer'),
		server: {
			// DialogueComposer imports ../../shared (outside renderer root).
			fs: {allow: [resolve('src')]}
		},
		resolve: {
			alias: [
				{
					find: '@fast-ide/ui/globals.css',
					replacement: resolve(uiRoot, 'src/styles/globals.css')
				},
				{
					find: '@fast-ide/ui',
					replacement: resolve(uiRoot, 'src')
				},
				{
					find: '@fast-ide/session-view',
					replacement: resolve(sessionViewRoot, 'src/index.ts')
				},
				{
					find: '@fast-ide/i18n/locales',
					replacement: resolve(i18nRoot, 'locales')
				},
				{
					find: '@fast-ide/i18n',
					replacement: resolve(i18nRoot, 'src/browser.ts')
				},
				{
					find: '@fastllm/bridge-protocol',
					replacement: bridgeProtocolDist
				},
				{
					find: '@',
					replacement: resolve('src/renderer/src')
				}
			]
		},
		optimizeDeps: {
			// Local file: package gains exports often; prebundling freezes a stale shape.
			exclude: ['@fastllm/bridge-protocol']
		},
		build: {
			rollupOptions: {
				input: {
					index: resolve('src/renderer/index.html'),
					pet: resolve('src/renderer/pet.html')
				}
			}
		},
		plugins: [
			react(),
			tailwindcss(),
			// vite-plugin-monaco-editor resolves a different vite copy than electron-vite.
			monacoEditorPlugin({
				languageWorkers: ['editorWorkerService', 'typescript', 'json', 'html', 'css']
			}) as never
		]
	}
});
