import type { MainWindow } from '../../MainWindow';
import { ShortcutPanel } from './ShortcutPanel';

export { ShortcutPanel } from './ShortcutPanel';
export { ShadingSection } from './ShadingSection';
export { BoneParentingSection } from './BoneParentingSection';

let panelInstance: ShortcutPanel | null = null;

export function createPanelContent(mainWindow?: MainWindow): HTMLElement {
    if (panelInstance) {
        panelInstance.dispose();
        panelInstance = null;
    }

    panelInstance = new ShortcutPanel({ mainWindow });
    return panelInstance.element;
}

export default ShortcutPanel;