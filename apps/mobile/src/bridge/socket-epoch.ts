/** Single native WebSocket: only the latest lease may send or disconnect. */
export class NativeSocketEpoch {
  private epoch = 0

  take(): {mine: () => boolean; release: (fn: () => void) => void} {
    const id = ++this.epoch
    return {
      mine: () => id === this.epoch,
      release: (fn) => {
        if (id === this.epoch) fn()
      }
    }
  }
}
