import SherpaOnnx from '@siteed/sherpa-onnx.rn';
import { Asset } from 'expo-asset';
import { Directory, File, Paths } from 'expo-file-system';

const MODEL_DIR = new Directory(Paths.document, 'models/sense-voice');

let enginePromise: Promise<void> | null = null;

async function copyModelAsset(assetSource: number, fileName: string) {
  const asset = Asset.fromModule(assetSource);
  await asset.downloadAsync();
  const dest = new File(MODEL_DIR, fileName);
  if (dest.exists) return;
  await new File(asset.localUri ?? asset.uri).copy(dest);
}

async function init() {
  if (!MODEL_DIR.exists) MODEL_DIR.create({ intermediates: true, idempotent: true });
  await Promise.all([
    copyModelAsset(require('../../assets/models/sense-voice/model.int8.onnx'), 'model.int8.onnx'),
    copyModelAsset(require('../../assets/models/sense-voice/tokens.txt'), 'tokens.txt')
  ]);
  await SherpaOnnx.initAsr({
    modelType: 'sense_voice',
    modelDir: MODEL_DIR.uri.replace('file://', ''),
    modelFiles: { model: 'model.int8.onnx', tokens: 'tokens.txt' },
    language: 'zh',
    useItn: true,
    numThreads: 2,
    debug: false
  });
}

export function ensureVoiceEngine(): Promise<void> {
  if (!enginePromise) {
    enginePromise = init().catch((e) => {
      enginePromise = null;
      throw e;
    });
  }
  return enginePromise;
}

export async function transcribeFile(uri: string): Promise<string> {
  await ensureVoiceEngine();
  const result = await SherpaOnnx.recognizeFromFile(uri);
  return result.text?.trim() ?? '';
}
