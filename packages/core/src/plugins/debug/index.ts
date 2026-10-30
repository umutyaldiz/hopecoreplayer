import { DebugPanel, type DebugPanelContext } from './DebugPanel';

export function installDebugPanel(ctx: DebugPanelContext): DebugPanel {
    return new DebugPanel(ctx);
}

export { DebugPanel };
export type { DebugPanelContext };
