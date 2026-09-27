export type PipelineStatus = 'offline' | 'connecting' | 'listening' | 'processing' | 'speaking' | 'error'
export type LiveSessionStatus = PipelineStatus

export type TranscriptRole = 'user' | 'assistant' | 'system'

export interface TranscriptEntry {
  id: string
  role: TranscriptRole
  text: string
  timestamp: number
  final: boolean
  isError?: boolean
  tool?: string
  toolCallId?: string
  toolStatus?: 'running' | 'completed' | 'failed'
  toolArgs?: any
  toolResult?: any
  error?: string
}
export type TranscriptItem = TranscriptEntry

export interface SessionConfig {
  apiKey: string
  model: string
  voice: string
  systemInstruction: string
}

export interface AppSettings {
  apiKey: string
  directAssistantModel: string
  coderAgentModel: string
  extendedThinkingEnabled: boolean
  thinkingBudget: string
  voice: string
  inputDeviceId: string
  outputDeviceId: string
  vadSensitivity: string
  pushToTalk: boolean
  directAssistantInstructions: string
  coderAgentInstructions: string
  longTermMemoryEnabled: boolean
  memoryLocation: string
  allowMouseKeyboardControl: boolean
  allowDesktopControl?: boolean
  desktopControlAlwaysAllowedSession?: boolean
  allowAutoTerminalCommands: boolean
  allowAutonomousBrowser: boolean
  allowedWorkspaceDirectories: string[]
  theme: string
  editorFontSize: number
  editorTheme: string
  editorFontFamily: string
  editorTabSize: number
  editorMinimap: boolean
  allowInAppSelfControl: boolean
  composioApiKey?: string
  githubToken?: string
  githubUsername?: string
  githubAvatarUrl?: string
}

export interface SweKitStatus {
  docker: {
    installed: boolean
    running: boolean
    version?: string
    error?: string
  }
  git: {
    installed: boolean
    version?: string
  }
  packages: {
    swekit: boolean
    swekit_version?: string
    composio_core: boolean
    composio_core_version?: string
  }
  github: {
    connected: boolean
    username?: string
    avatar_url?: string
  }
  composio: {
    configured: boolean
  }
  ready: boolean
}

export interface MCPToolInfo {
  name: string
  description: string
  required: string[]
}

export interface MCPServerInfo {
  id: string
  name: string
  enabled: boolean
  agents: string[]
  description: string
  status: 'connected' | 'connecting' | 'disconnected' | 'error'
  last_error: string | null
  tool_count: number
  tools: MCPToolInfo[]
  logs: string[]
}

export interface MCPStatusData {
  node: {
    available: boolean
    node_path: string
    npx_path: string
    message: string
  }
  servers: Record<string, MCPServerInfo>
}

export interface TrialMeta {
  trial_id: string
  command: string
  exit_code: number
  status: 'pending_review' | 'applied' | 'rejected'
  created_at: number
  modified_files: string[]
  additions: number
  deletions: number
  diff: string
  logs?: string[]
}

export interface ProjectStats {
  sizeBytes: number
  humanSize: string
  folderCount: number
  fileCount: number
  lastScanned?: string
}

export interface ProjectItem {
  id: string
  name: string
  path: string
  isCore?: boolean
  lastOpened: number
  stats?: ProjectStats
}

export const DEFAULT_LIVE_MODEL = 'gemini-3.8-live'
export const THINKING_LIVE_MODEL = 'gemini-3.8-live-extended-thinking'

export type ServerEvent =
  | { type: 'status'; status: PipelineStatus; message?: string }
  | { type: 'transcript'; role: 'user' | 'assistant' | 'system'; text: string; final?: boolean }
  | { type: 'audio'; data: string; mime_type: string }
  | { type: 'turn.complete' }
  | { type: 'interrupted' }
  | { type: 'error'; code?: string; message: string }
  | { type: 'session.ready'; model: string }
  | { type: 'thinking.changed'; enabled: boolean; mode: 'think' | 'normal'; model: string }
  | { type: 'tool.result'; name: string; result: unknown }

declare global {
  interface Window {
    arixDesktop?: {
      getVersion: () => Promise<string>
      openExternal: (url: string) => Promise<boolean>
      openLogsFolder: () => Promise<boolean>
      revealInFolder: (path: string) => Promise<boolean>
      platform: string
    }
    arixSettings?: {
      get: () => Promise<AppSettings>
      set: (settings: Partial<AppSettings>) => Promise<AppSettings>
      getApiKey: () => Promise<string>
      setApiKey: (key: string) => Promise<boolean>
      testApiKey: (key?: string) => Promise<{ ok: boolean; message: string }>
      reset: () => Promise<AppSettings>
    }
    arixProjects?: {
      selectFolder: () => Promise<string | null>
      getProjects?: () => Promise<ProjectItem[]>
    }
    arixScreenShare?: {
      getSources: (opts?: any) => Promise<Array<{ id: string; name: string; thumbnailDataUrl: string }>>
    }
  }
}
