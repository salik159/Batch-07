export {};
declare global {
  interface Window {
    neura?: {
      isDesktop: boolean;
      runAgent: (command: string) => Promise<any>;
      cancelAgent: () => Promise<boolean>;
      openUrl: (url: string) => Promise<void>;
      gmailStatus: () => Promise<{configured:boolean;connected:boolean;scope:string}>;
      gmailConnect: () => Promise<{speech:string;display:string}>;
      gmailDisconnect: () => Promise<{speech:string;display:string}>;
      openAndReadNews: (url: string) => Promise<string>;
      listenLocal: () => Promise<{text: string}>;
      stopLocalVoice: () => Promise<boolean>;
      speakLocal: (text: string) => Promise<{ok: boolean}>;
      stopSpeaking: () => Promise<boolean>;
      transcribeAudio: (audio: string, mimeType: string, model?: string) => Promise<{text: string}>;
      speak: (text: string) => Promise<{audio: string; mimeType: string}>;
      onAgentEvent: (callback: (event: any) => void) => () => void;
      onVoiceState: (callback: (event: { state: 'idle'|'activated'|'listening'|'thinking'|'executing'|'speaking'|'stopping'|'error'; message?: string; timestamp?: number }) => void) => () => void;
      onVoiceCommand: (callback: (event: { text: string; audioPath?: string }) => void) => () => void;
      setVoiceState: (state: string) => Promise<{ ok: boolean; state: string }>;
      getVoiceState: () => Promise<string>;
      emulateVoice: (text: string) => Promise<boolean>;
    };
  }
}
