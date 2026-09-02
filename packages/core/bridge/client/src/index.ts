export {bridgePaths, isStdioTransport, type BridgePaths} from './paths.js';
export {
	ensureDaemon,
	rocksLockPath,
	rocksLockHolders,
	isBridgeEngineCommand,
	isLiveBridgeHost,
	liveBridgePids,
	resolveDaemonLaunch,
	engineBinName,
	placedEngineCli,
	resourcesEngineCli,
	engineCommandLine,
	isPidAlive,
	readPidFile,
	claimPidExclusive,
	CONNECT_TIMEOUT_MS,
	STARTUP_TIMEOUT_MS,
	type EnsureDaemonResult,
	type EnsureDaemonDeps
} from './ensureDaemon.js';
export {
	commandOwnsCli,
	engineRootFromCli,
	isPublicWsBind,
	shouldReplaceDaemon,
	shouldStopDaemonOnQuit,
	trimmedId,
	waitWhile
} from './engineIdentity.js';
export {stopOwnedLocal, type StopOwnedLocalOpts} from './stopOwnedLocal.js';
export {
	connectUnix,
	tryConnectUnix,
	type ConnectUnixOpts,
	type UnixConnection,
	type UnixConnectionHandlers
} from './unixConnection.js';
export {
	connectWs,
	tlsClientOptions,
	type ConnectWsOptions,
	type RemoteBridgeConnectionOptions,
	type RemoteBridgeTls,
	type WsConnection,
	type WsConnectionHandlers,
	type WsFactory,
	type WsSocketLike
} from './wsConnection.js';
export {probeBridge, classifyProbeError, type ProbeCode, type ProbeResult} from './probe.js';
export {
	inspectTls,
	normalizeFingerprint,
	tryNormalizeFingerprint,
	displayFingerprint,
	fingerprintOf,
	type InspectTls
} from './tlsPin.js';
export {
	BridgeHost,
	type BridgeHostConnectOptions,
	type BridgeHostDeps,
	type BridgeHostHandlers
} from './BridgeHost.js';
export {
	extAdminMethods,
	extensionPayload,
	restartHint,
	type ExtAdminApi,
	type ExtErr,
	type ExtNote,
	type ExtOk,
	type ExtPhase,
	type ExtRow
} from './extensions.js';
export {
	engAdminMethods,
	type EngAdminApi,
	type EngErr,
	type EngOk,
	type EngineRow
} from './engines.js';
