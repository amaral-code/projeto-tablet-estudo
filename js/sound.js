// Sons de foco gerados no próprio tablet (sem internet): ruído branco, rosa, marrom e chuva.
export const SOUNDS = { none: 'Sem som', white: 'Ruído branco', pink: 'Ruído rosa', brown: 'Ruído marrom', rain: 'Chuva' };

let ac = null, src = null, gain = null, current = 'none', volume = 0.4, extra = [];

function noiseBuffer(type) {
  const len = ac.sampleRate * 4;
  const buf = ac.createBuffer(2, len, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (type === 'white') d[i] = w * 0.5;
      else if (type === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      else { // rosa (Paul Kellet)
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
      }
    }
  }
  return buf;
}

export function playSound(type, vol = volume) {
  volume = vol;
  stopSound();
  current = type;
  if (type === 'none') return;
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === 'suspended') ac.resume();
    gain = ac.createGain();
    gain.gain.value = 0;
    gain.gain.linearRampToValueAtTime(volume, ac.currentTime + 1.2);
    gain.connect(ac.destination);
    src = ac.createBufferSource();
    src.buffer = noiseBuffer(type === 'rain' ? 'pink' : type);
    src.loop = true;
    let node = src;
    if (type === 'rain') {
      // chuva: ruído rosa filtrado com intensidade variando lentamente
      const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 400;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6000;
      const mod = ac.createGain(); mod.gain.value = 0.8;
      const lfo = ac.createOscillator(); lfo.frequency.value = 0.15;
      const lfoGain = ac.createGain(); lfoGain.gain.value = 0.2;
      lfo.connect(lfoGain); lfoGain.connect(mod.gain); lfo.start();
      node.connect(hp); hp.connect(lp); lp.connect(mod); node = mod;
      extra = [hp, lp, mod, lfo, lfoGain];
    }
    node.connect(gain);
    src.start();
  } catch { current = 'none'; }
}
export function stopSound() {
  try { if (src) src.stop(); } catch { /* */ }
  for (const n of extra) { try { n.disconnect(); if (n.stop) n.stop(); } catch { /* */ } }
  try { if (gain) gain.disconnect(); } catch { /* */ }
  src = null; gain = null; extra = []; current = 'none';
}
export function setVolume(v) { volume = v; if (gain && ac) gain.gain.setTargetAtTime(v, ac.currentTime, 0.1); }
export const soundPlaying = () => current;
