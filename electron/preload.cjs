const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('neura', {
  isDesktop: true,
  runAgent: (command) => ipcRenderer.invoke('agent:run', command),
  cancelAgent: () => ipcRenderer.invoke('agent:cancel'),
  openUrl: (url) => ipcRenderer.invoke('system:open-url', url)
  ,gmailStatus: () => ipcRenderer.invoke('gmail:status')
  ,gmailConnect: () => ipcRenderer.invoke('gmail:connect')
  ,gmailDisconnect: () => ipcRenderer.invoke('gmail:disconnect')
  ,openAndReadNews: (url) => ipcRenderer.invoke('news:open-read', url)
  ,listenLocal: () => ipcRenderer.invoke('voice:listen-local')
  ,stopLocalVoice: () => ipcRenderer.invoke('voice:stop-local')
  ,speakLocal: (text) => ipcRenderer.invoke('voice:speak-local', text)
  ,stopSpeaking: () => ipcRenderer.invoke('voice:stop-speaking')
  ,transcribeAudio: (audio, mimeType, model) => ipcRenderer.invoke('voice:transcribe', { audio, mimeType, model })
  ,speak: (text) => ipcRenderer.invoke('voice:speak', text)
  ,onAgentEvent: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('agent:event', handler);
    return () => ipcRenderer.removeListener('agent:event', handler);
  }
  ,onVoiceState: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('voice:state', handler);
    return () => ipcRenderer.removeListener('voice:state', handler);
  }
  ,onVoiceCommand: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('voice:command', handler);
    return () => ipcRenderer.removeListener('voice:command', handler);
  }
  ,setVoiceState: (state) => ipcRenderer.invoke('voice:set-state', state)
  ,getVoiceState: () => ipcRenderer.invoke('voice:get-state')
  ,emulateVoice: (text) => ipcRenderer.invoke('voice:emulate', text)
});
