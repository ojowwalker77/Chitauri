// FILE: appSnapSound.ts
// Purpose: Plays a short local capture confirmation without blocking delivery.

export async function playAppSnapSound(): Promise<void> {
  if (typeof AudioContext === "undefined") return;
  let context: AudioContext | null = null;
  try {
    context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(740, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(980, context.currentTime + 0.08);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.12);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.13);
    await new Promise<void>((resolve) => {
      oscillator.addEventListener("ended", () => resolve(), { once: true });
    });
  } catch (error) {
    console.warn("[appsnap] Could not play the local capture sound", error);
  } finally {
    await context?.close().catch(() => undefined);
  }
}
