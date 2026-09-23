
import type { MainWindow } from '../../MainWindow';
import { ShadingPanel } from './ShadingPanel';

export { ShadingPanel } from './ShadingPanel';
export { MaterialListSection } from './MaterialListSection';
export { MaterialParamsSection } from './MaterialParamsSection';

let panelInstance: ShadingPanel | null = null;

/** @deprecated 使用 ShadingPanel 直接实例化 */
export function createPanelContent(mainWindow?: MainWindow): HTMLElement {
    if (panelInstance) {
        panelInstance.dispose();
        panelInstance = null;
    }

    panelInstance = new ShadingPanel({ mainWindow });

    return panelInstance.element;
}

export default ShadingPanel;
