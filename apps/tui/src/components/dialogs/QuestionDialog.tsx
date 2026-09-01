import React, {useState} from 'react';
import {Box, Text, useInput} from 'ink';
import type {UserQuestion} from '../../state/model.js';
import {moveSelection} from '../../dialogs/dialogState.js';
import {useTheme} from '../../contexts/ThemeContext.js';

type Props = {
	question: UserQuestion;
	onAnswer: (id: string, answer: string | {selectedOptionId?: string; customText?: string}) => void;
};

export function QuestionDialog({question, onAnswer}: Props) {
	const {theme} = useTheme();
	const options = [
		...question.options,
		...(question.allowCustom ? [{id: '__custom__', label: 'Type something'}] : [])
	];
	const hasSelectableOptions = options.length > 0;
	const [selected, setSelected] = useState(
		Math.max(0, options.findIndex(o => o.recommended))
	);

	const submitOption = (optionId: string) => {
		if (optionId === '__custom__') return;
		onAnswer(question.id, {selectedOptionId: optionId});
	};

	useInput((input, key) => {
		if (!hasSelectableOptions) {
			return;
		}
		if (key.upArrow) setSelected(s => moveSelection(s, options.length, 'up'));
		if (key.downArrow) setSelected(s => moveSelection(s, options.length, 'down'));
		if (key.return) {
			const option = options[selected];
			if (option) submitOption(option.id);
		}
		const numeric = Number.parseInt(input, 10);
		if (!Number.isNaN(numeric) && numeric >= 1 && numeric <= options.length) {
			const option = options[numeric - 1];
			if (option) submitOption(option.id);
		}
	});

	return (
		<Box flexDirection="column" borderStyle="single" borderColor={theme.border.focus} paddingX={1} marginY={1}>
			{question.title && <Text color={theme.text.accent} bold>{question.title}</Text>}
			<Text>{question.question}</Text>
			{hasSelectableOptions ? (
				<>
					<Box flexDirection="column" marginTop={1}>
						{options.map((option, index) => (
							<Text key={option.id}>
								<Text color={index === selected ? theme.text.accent : undefined}>
									{index === selected ? '❯ ' : '  '}{index + 1}. {option.label}
								</Text>
								{option.description && <Text dimColor> — {option.description}</Text>}
							</Text>
						))}
					</Box>
					<Text dimColor>↑↓ or number • Enter • custom text in composer</Text>
				</>
			) : (
				<>
					<Box marginTop={1}>
						<Text dimColor>No predefined options. Type your answer in composer.</Text>
					</Box>
					<Text dimColor>custom text in composer • Enter submit</Text>
				</>
			)}
		</Box>
	);
}
