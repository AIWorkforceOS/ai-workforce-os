/** Trava contra duplo toque em "Salvar": enquanto um salvamento está rodando, outro toque é ignorado; ao terminar (ou falhar) libera. */
export function createSubmitGuard() {
  let running = false
  return {
    get active() {
      return running
    },
    async run<T>(fn: () => Promise<T>): Promise<{ ran: true; value: T } | { ran: false }> {
      if (running) return { ran: false }
      running = true
      try {
        return { ran: true, value: await fn() }
      } finally {
        running = false
      }
    },
  }
}
