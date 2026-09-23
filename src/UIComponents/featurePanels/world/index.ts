
import type { MainWindow } from '../../MainWindow';
import { WorldPanel } from './WorldPanel';

export { WorldPanel } from './WorldPanel';
export { LightingSection } from './LightingSection';
export { BackgroundSection } from './BackgroundSection';
export { GroundSection } from './GroundSection';
export { ParticleSection } from './ParticleSection';
export { EnvironmentMapHelper, clearEnvironmentMapCache, getCachedEnvironmentMaps, getEnvironmentMapCacheSize } from './EnvironmentMapHelper';

let worldPanelInstance: WorldPanel | null = null;

export function createPanelContent(mainWindow?: MainWindow): HTMLElement {
    if (worldPanelInstance) {
        worldPanelInstance.dispose();
        worldPanelInstance = null;
    }

    worldPanelInstance = new WorldPanel({
        sceneManager: mainWindow?.getSceneManager() ?? null,
        gridVisible: mainWindow?.getGridVisible() ?? true,
        onGridToggle: (visible) => mainWindow?.setGridVisible(visible)
    });

    return worldPanelInstance.element;
}

export default WorldPanel;
