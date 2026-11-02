const API = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!response.ok) throw new Error((await response.text().catch(() => "")) || `API request failed: ${response.status}`);
  return response.json() as Promise<T>;
}
export interface SystemMetrics { cpu:number; ram:number; gpu:number; temp:number; net:number; tokens:number; apiCalls:number; queue:number; }
export interface WeatherData { temp:number; desc:string; city:string; wind:number; humidity:number; }
export interface NewsItem { tag:string; title:string; source?:string; url?:string; publishedAt?:string; }
export const getSystemMetrics = () => request<SystemMetrics>("/api/system");
export const getWeather = () => request<WeatherData>("/api/weather");
export const getNews = () => request<NewsItem[]>("/api/news");
export const runTask = (prompt:string) => request<{text:string;model:string}>("/api/ai", {method:"POST", body:JSON.stringify({prompt})});

export const transcribeAudio = (audio:string, mimeType:string, model?:string) => request<{text:string}>("/api/voice/transcribe", {method:"POST", body:JSON.stringify({audio,mimeType,model})});
export const speakText = (text:string) => request<{audio:string;mimeType:string}>("/api/voice/speak", {method:"POST", body:JSON.stringify({text})});
export const answerNews = (question:string) => request<{text:string;items:NewsItem[]}>("/api/news/answer", {method:"POST", body:JSON.stringify({question})});

export interface AIProviderStatus {
  ok: boolean;
  provider: string;
  model: string;
  error?: string;
  ollamaModels?: string[];
}

export const getAIStatus = () => request<AIProviderStatus>("/api/ai/status");
export const testAIProvider = (provider: string) => request<AIProviderStatus>("/api/ai/test", { method: "POST", body: JSON.stringify({ provider }) });
export const setAIProvider = (provider: string, model?: string) => request<{ ok: boolean; provider: string; model: string }>("/api/ai/provider", { method: "POST", body: JSON.stringify({ provider, model }) });

