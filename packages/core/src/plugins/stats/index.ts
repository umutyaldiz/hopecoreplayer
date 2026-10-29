import { StatsPanel, type StatsPlayerContext } from './StatsPanel';

export function installStats(ctx: StatsPlayerContext): StatsPanel {
    return new StatsPanel(ctx);
}

export { StatsPanel };
export type { StatsPlayerContext };
