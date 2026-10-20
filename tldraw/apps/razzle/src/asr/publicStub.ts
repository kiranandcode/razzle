// What src/asr/ resolves to in the public build (vite.config.ts): no mic, no speech engine.
export const MicToggle = (_: { variant: 'speaker' | 'studio' }) => null
export const useBrowserMic = () => false
export const useAutoMic = (_active: boolean, _opts: { claim: boolean }) => {}
export const micStart = async (_how?: 'user' | 'auto') => {}
export const micStop = async (_how?: 'user' | 'auto') => {}
export const micToggle = async () => {}
