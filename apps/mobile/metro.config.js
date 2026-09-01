import { getDefaultConfig } from 'expo/metro-config';
import path from 'node:path';
import { withUniwindConfig } from 'uniwind/metro';

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.resolver.assetExts.push('onnx', 'txt');

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules')
];

config.resolver.resolveRequest = (context, moduleName, platform) => {
  try {
    return context.resolveRequest(context, moduleName, platform);
  } catch (error) {
    if (moduleName.startsWith('.') && moduleName.endsWith('.js')) {
      const base = moduleName.slice(0, -3);
      for (const ext of ['.ts', '.tsx']) {
        try {
          return context.resolveRequest(context, base + ext, platform);
        } catch {}
      }
    }
    throw error;
  }
};

export default withUniwindConfig(config, {
  cssEntryFile: './src/global.css',
});
