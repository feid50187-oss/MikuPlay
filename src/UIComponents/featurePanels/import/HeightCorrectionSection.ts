import type { CameraManager } from '../../../features/mmd';
import { VectorInput } from '../../shared/VectorInput';
import { ToggleSwitch } from '../../shared/ToggleSwitch';

export class HeightCorrectionSection {
    readonly element: HTMLElement;

    private cameraManager: CameraManager;
    private vectorInput: VectorInput;
    private clampToggle: ToggleSwitch;

    constructor(cameraManager: CameraManager) {
        this.cameraManager = cameraManager;
        this.vectorInput = new VectorInput({
            label: '相机微调',
            components: [
                { name: 'X', value: 0, min: -200, max: 200, step: 1 },
                { name: 'Y', value: 0, min: -200, max: 200, step: 1 },
                { name: 'Z', value: 0, min: -200, max: 200, step: 1 }
            ]
        });
        this.vectorInput.onChange((values) => {
            const x = values[0] ;
            const y = values[1] ;
            const z = values[2] ;
            this.cameraManager.setTargetOffset(x, y, z);
        });

        // 防入地钳制开关，默认关闭
        this.clampToggle = new ToggleSwitch({ label: '防入地钳制', initialState: false });
        this.clampToggle.onChange((enabled) => {
            this.cameraManager.setClampToGround(enabled);
        });

        // 组合容器，放置微调输入与钳制开关
        const container = document.createElement('div');
        container.appendChild(this.vectorInput.element);
        container.appendChild(this.clampToggle.element);
        this.element = container;
    }

    dispose(): void {
        this.vectorInput.dispose();
        this.clampToggle.dispose();
    }
}