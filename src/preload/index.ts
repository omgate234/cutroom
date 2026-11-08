import { contextBridge, ipcRenderer, webUtils } from 'electron'

const invoke =
  (channel: string) =>
  (...args: unknown[]): Promise<any> =>
    ipcRenderer.invoke(channel, ...args)

const api = {
  settings: {
    get: invoke('settings:get'),
    set: invoke('settings:set'),
    validateKey: invoke('settings:validate-key')
  },
  detectAgents: invoke('agents:detect'),
  setTheme: invoke('theme:set'),
  project: {
    pick: invoke('project:pick'),
    open: invoke('project:open'),
    close: invoke('project:close'),
    compile: invoke('project:compile'),
    writeTimeline: invoke('project:write-timeline'),
    history: invoke('project:history'),
    restore: invoke('project:restore'),
    undo: invoke('project:undo'),
    export: invoke('project:export'),
    reveal: invoke('project:reveal'),
    importFiles: invoke('project:import-files'),
    importPaths: invoke('project:import-paths'),
    importUrl: invoke('project:import-url'),
    rename: invoke('project:rename')
  },
  projects: {
    list: invoke('projects:list'),
    create: invoke('projects:create'),
    update: invoke('projects:update'),
    remove: invoke('projects:remove')
  },
  attach: {
    pick: invoke('attach:pick'),
    paths: invoke('attach:paths'),
    save: invoke('attach:save')
  },
  skills: { status: invoke('skills:status'), install: invoke('skills:install') },
  agent: {
    start: invoke('agent:start'),
    status: invoke('agent:status'),
    prompt: invoke('agent:prompt'),
    cancel: invoke('agent:cancel'),
    setMode: invoke('agent:set-mode'),
    reply: invoke('agent:permission-reply')
  },
  openExternal: invoke('shell:open'),
  reveal: invoke('shell:reveal'),
  pathForFile: (f: File): string => webUtils.getPathForFile(f),
  on(channel: string, cb: (payload: any) => void): () => void {
    const fn = (_e: unknown, payload: unknown): void => cb(payload)
    ipcRenderer.on(channel, fn)
    return () => ipcRenderer.removeListener(channel, fn)
  }
}

export type Api = typeof api
contextBridge.exposeInMainWorld('api', api)
