// A short generated tone (Web Audio API) rather than a bundled audio file —
// no extra asset, no licensing to think about. Browsers suspend new
// AudioContexts until the page has received some user interaction; this
// resumes it opportunistically each call rather than requiring an explicit
// "enable sound" button, since normal panel use (clicking cells, typing
// filters) already satisfies that requirement in practice.
let sharedContext: AudioContext | null = null;

function getContext(): AudioContext | null {
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) {
    return null;
  }
  if (!sharedContext) {
    sharedContext = new AudioContextClass();
  }
  return sharedContext;
}

export function playAlertSound(): void {
  try {
    const ctx = getContext();
    if (!ctx) {
      return;
    }
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.3);
  } catch {
    // audio unavailable — fail silently, no functional impact otherwise
  }
}
