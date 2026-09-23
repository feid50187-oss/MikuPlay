
import type { MainWindow } from '../../MainWindow';
import { ImportPanel } from './ImportPanel';

export { ImportPanel } from './ImportPanel';
export type { ImportPanelServices, FrameControlCallbacks } from './ImportPanelServices';
export { ModelSection } from './ModelSection';
export { AnimationSection } from './AnimationSection';
export { MusicSection } from './MusicSection';
export { CameraSection } from './CameraSection';
export { FrameController } from './FrameController';
export { HeightCorrectionSection } from './HeightCorrectionSection';

let importPanelInstance: ImportPanel | null = null;

export function createPanelContent(mainWindow?: MainWindow): HTMLElement {
    if (importPanelInstance) {
        importPanelInstance.dispose();
        importPanelInstance = null;
    }

    const services = mainWindow?.getImportPanelServices();
    if (!services) {
        const placeholder = document.createElement('div');
        placeholder.className = 'import-panel';
        placeholder.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">正在初始化...</div>';
        return placeholder;
    }

    importPanelInstance = new ImportPanel(services);
    return importPanelInstance.element;
}

export default ImportPanel;
