/**
 * Display-only @mention tag chrome — text content unchanged.
 */
import {
	Children,
	cloneElement,
	isValidElement,
	type ReactElement,
	type ReactNode
} from 'react';
import {draftHasMentionTags, mentionDraftSegments} from './atCatalog';

/** System blue accent (CONTEXT: #007AFF / #0A84FF) — match Composer / slash chip. */
const MENTION_CHIP =
	'rounded-sm box-decoration-clone bg-[#007AFF]/10 text-[#007AFF] dark:bg-[#0A84FF]/15 dark:text-[#0A84FF]';

export function MentionText({
	text,
	className
}: {
	text: string;
	className?: string;
}) {
	if (!draftHasMentionTags(text)) {
		return className ? <span className={className}>{text}</span> : <>{text}</>;
	}
	return (
		<span className={className}>
			{mentionDraftSegments(text).map((seg, i) =>
				seg.type === 'mention' ? (
					<span key={i} className={MENTION_CHIP}>
						{seg.text}
					</span>
				) : (
					<span key={i}>{seg.text}</span>
				)
			)}
		</span>
	);
}

/** Recurse ReactMarkdown children; skip code/pre so refs inside fences stay plain. */
export function mentionizeTree(node: ReactNode): ReactNode {
	return Children.map(node, child => {
		if (typeof child === 'string' || typeof child === 'number') {
			const s = String(child);
			return draftHasMentionTags(s) ? <MentionText text={s} /> : child;
		}
		if (!isValidElement(child)) return child;
		const el = child as ReactElement<{children?: ReactNode}>;
		const type = el.type;
		if (type === 'code' || type === 'pre') return child;
		const kids = el.props.children;
		if (kids == null) return child;
		return cloneElement(el, {...el.props}, mentionizeTree(kids));
	});
}
