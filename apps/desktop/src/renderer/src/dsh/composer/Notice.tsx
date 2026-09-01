import {openDshModelsSettings, useDshModels} from './models';

export function Notice() {
	const snap = useDshModels();
	return (
		<>
			{snap.error?.code === 'MISSING_CREDENTIAL' ? (
				<div className="flex items-center justify-between gap-2 px-4 pt-2 text-[11px] text-destructive">
					<span>{snap.error.message ?? 'MISSING_CREDENTIAL'}</span>
					<button type="button" className="underline text-foreground" onClick={openDshModelsSettings}>
						去填密钥
					</button>
				</div>
			) : null}
			{snap.routable === false ? (
				<p className="px-4 pt-2 text-[11px] text-muted-foreground">当前提供方无路由，换一个模型再发送</p>
			) : null}
		</>
	);
}
