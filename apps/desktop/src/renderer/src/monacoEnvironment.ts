import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

const TS_LABELS = new Set(['javascript', 'typescript']);
const JSON_LABELS = new Set(['json']);
const CSS_LABELS = new Set(['css', 'less', 'scss']);
const HTML_LABELS = new Set(['handlebars', 'html', 'razor']);

globalThis.MonacoEnvironment = {
	getWorker(_workerId, label) {
		if (JSON_LABELS.has(label)) return new JsonWorker();
		if (CSS_LABELS.has(label)) return new CssWorker();
		if (HTML_LABELS.has(label)) return new HtmlWorker();
		if (TS_LABELS.has(label)) return new TsWorker();
		return new EditorWorker();
	}
};
