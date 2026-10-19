export function createEasterSound(id, volume = 0.6, onEnded = () => {}) {
  let context;
  let master;
  let playing = false;
  let offset = 0;
  const notes = id === 'ouye' ? [72, 76, 79, 76, 74, 79, 81, 79, 76, 74, 72, 67, 72, 76, 79, 84] : [62, 69, 72, 74, 72, 69, 65, 69, 62, 65, 69, 72, 69, 65, 62, 57];
  return {
    async play() {
      const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Audio) throw new Error('此设备暂不支持原创小调，请选择本机音频。');
      if (context && context.currentTime >= offset + 16) { void context.close().catch(() => {}); context = null; }
      if (!context) {
        context = new Audio();
        master = context.createGain();
        master.gain.value = Math.max(0, Math.min(1, Number(volume) || 0)) * 0.12;
        master.connect(context.destination);
        offset = context.currentTime + 0.03;
        for (let index = 0; index < 64; index++) {
          const oscillator = context.createOscillator(), gain = context.createGain();
          const start = offset + index * 0.25;
          oscillator.type = 'sine';
          oscillator.frequency.value = 440 * 2 ** ((notes[index % notes.length] - 69) / 12);
          gain.gain.setValueAtTime(0, start);
          gain.gain.linearRampToValueAtTime(0.7, start + 0.012);
          gain.gain.exponentialRampToValueAtTime(0.001, start + 0.24);
          oscillator.connect(gain); gain.connect(master);
          oscillator.start(start); oscillator.stop(start + 0.25);
          if (index === 63) oscillator.onended = () => { playing = false; onEnded(); };
        }
      }
      await context.resume();
      playing = true;
    },
    pause() { playing = false; void context?.suspend().catch(() => {}); },
    destroy() { playing = false; void context?.close().catch(() => {}); context = null; },
    get paused() { return !playing || Boolean(context && context.currentTime >= offset + 16); },
  };
}
