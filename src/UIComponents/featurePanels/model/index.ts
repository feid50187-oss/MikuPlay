
import type { MainWindow } from '../../MainWindow';
import { ModelOptPanel } from './ModelOptPanel';
import { Events, eventBus } from '../../../core';
import { ModelOptStateManager } from '../../../features/state/ModelOptStateManager';

export { ModelOptPanel } from './ModelOptPanel';
export { BoneOperationSection } from './BoneOperationSection';
export { BoneCorrectionSection } from './BoneCorrectionSection';
export { MorphOperationSection } from './MorphOperationSection';

let panelInstance: ModelOptPanel | null = null;

/** @deprecated 使用 ModelOptPanel 直接实例化 */
export function createPanelContent(mainWindow?: MainWindow): HTMLElement {
    if (panelInstance) {
        panelInstance.dispose();
        panelInstance = null;
    }

    panelInstance = new ModelOptPanel({ mainWindow });

    return panelInstance.element;
}

export function onSelectedModelChange(callback: (modelId: string | null) => void): () => void {
    return eventBus.on(Events.MODEL_SELECTED, callback);
}

export function getSelectedModel(): string | null {
    return ModelOptStateManager.getInstance().getSelectedModel();
}

export default ModelOptPanel;
