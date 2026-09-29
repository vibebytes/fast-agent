/** Web has no on-device speech model; the web voice button uses the browser's SpeechRecognition instead. */
export async function ensureVoiceEngine(): Promise<void> {}

export async function transcribeFile(_uri: string): Promise<string> {
  throw new Error('On-device transcription is not available on web');
}
