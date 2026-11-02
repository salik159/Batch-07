export type ModeId = 'home' | 'agent' | 'world' | 'settings';

export type AgentStatus = 'ok' | 'busy' | 'warn';

export interface AgentInfo {
  name: string;
  task: string;
  status: AgentStatus;
  badge: string;
}

export interface NewsItem {
  tag: string;
  title: string;
  source?: string;
  url?: string;
  publishedAt?: string;
}

export interface CoreAccent {
  glow: string;       // "r,g,b" for CSS/texture use
  inner: string;      // hex
  shell: string;      // hex
  particles: string;  // hex
}
