import type { SceneManager } from '../../../features/scene';
import { Dropdown } from '../../shared/Dropdown';
import { Slider } from '../../shared/Slider';
import { VectorInput } from '../../shared/VectorInput';
import { CollapsibleSection } from '../../shared/CollapsibleSection';
import { Events, eventBus, pluginRegistry } from '../../../core';
import { BackgroundStateManager } from '../../../features/state';
import { EnvironmentMapHelper } from './EnvironmentMapHelper';
import { MediaBackgroundManager } from '../../../features/scene/MediaBackgroundManager';
import { mediaPickerManager } from '../../../plugins/MediaPicker';
import { Capacitor } from '@capacitor/core';
import { rgbToHex, hexToRgb } from '../../../utils/color';

export class BackgroundSection {
    readonly element: HTMLElement;
    private sceneManager: SceneManager | null;
    private bgManager: BackgroundStateManager;
    private collapsible: CollapsibleSection | null = null;
    private dropdown: Dropdown | null = null;
    private sliders: Slider[] = [];
    private vectorInputs: VectorInput[] = [];
    private paramsContainer: HTMLElement;
    private envMapHelper: EnvironmentMapHelper | null = null;
    private currentMediaBackground: MediaBackgroundManager | null = null;

    constructor(sceneManager: SceneManager | null) {
        this.sceneManager = sceneManager;
        this.bgManager = BackgroundStateManager.getInstance();
        this.paramsContainer = document.createElement('div');
        this.paramsContainer.className = 'world-background-params';
        this.envMapHelper = new EnvironmentMapHelper(
            sceneManager?.getScene() ?? null,
            (path) => {
                if (path) {
                    this.bgManager.setEnvironmentTexturePath(path);
                }
            }
        );
        this.element = this.create();
    }

    private getBackgroundTypeOptions(): Array<{ value: string; label: string }> {
        const bgPlugins = pluginRegistry.getByTarget('background');
        const builtInOptions = [
            { value: 'color', label: '颜色背景' },
            { value: 'environment', label: '环境贴图' },
            { value: 'media', label: '媒体背景' },
            { value: 'transparent', label: '透明背景' }
        ];
        return [
            ...builtInOptions,
            ...bgPlugins
                .filter(p => !p.builtIn)
                .map(p => ({
                    value: p.manifest.id,
                    label: p.manifest.name,
                })),
        ];
    }

    private create(): HTMLElement {
        this.collapsible = new CollapsibleSection({ title: '背景控制', initiallyExpanded: false });
        this.collapsible.element.classList.add('world-item');
        const inner = this.collapsible.getContentContainer();
        inner.style.padding = '0 20px 16px 20px';
        inner.style.display = 'flex';
        inner.style.flexDirection = 'column';
        inner.style.gap = '12px';
        this.collapsible.element.querySelector('.mp-collapsible-header')!.classList.add('world-item-header');
                // 展开时允许内容溢出（下拉框等）
        this.collapsible.onChange((expanded) => {
            this.collapsible!.element.classList.toggle('overflow-visible', expanded);
        });

        const backgroundTypes = this.getBackgroundTypeOptions();

        const initialState = this.bgManager.getState();

        this.dropdown = new Dropdown({
            options: backgroundTypes,
            selectedValue: initialState.type
        });
        this.dropdown.onChange((selectedType) => {
            this.bgManager.setType(selectedType);
            this.renderParamsArea();
        });

        this.collapsible.getContentContainer().appendChild(this.dropdown.element);
        this.collapsible.getContentContainer().appendChild(this.paramsContainer);

        this.renderParamsArea();

        return this.collapsible.element;
    }

    private renderParamsArea(): void {
        this.cleanupParams();
        this.paramsContainer.innerHTML = '';

        const state = this.bgManager.getState();

        switch (state.type) {
            case 'color':
                this.envMapHelper?.dispose();
                this.disposeMediaBackground();
                this.bgManager.setEnvironmentTexturePath(null);
                this.sceneManager?.setTransparentBackground(false);
                this.renderColorParams();
                break;
            case 'environment':
                this.disposeMediaBackground();
                this.sceneManager?.setTransparentBackground(false);
                this.renderEnvironmentParams();
                break;
            case 'media':
                this.envMapHelper?.dispose();
                this.bgManager.setEnvironmentTexturePath(null);
                this.sceneManager?.setTransparentBackground(false);
                this.renderMediaParams();
                break;
            case 'transparent':
                this.envMapHelper?.dispose();
                this.disposeMediaBackground();
                this.bgManager.setEnvironmentTexturePath(null);
                this.renderTransparentParams();
                break;
        }
    }

    private cleanupParams(): void {
        this.sliders.forEach(s => s.dispose());
        this.vectorInputs.forEach(v => v.dispose());
        this.sliders = [];
        this.vectorInputs = [];
    }

    private renderColorParams(): void {
        const config = this.sceneManager?.getConfig();
        const hexColor = config?.backgroundColor ?? 'E0E0E0';
        const initialColor = hexToRgb(`#${hexColor.replace('#', '')}`);

        const rSlider = new Slider({
            label: 'R',
            min: 0,
            max: 255,
            step: 1,
            value: Math.round(initialColor.r * 255)
        });

        const gSlider = new Slider({
            label: 'G',
            min: 0,
            max: 255,
            step: 1,
            value: Math.round(initialColor.g * 255)
        });

        const bSlider = new Slider({
            label: 'B',
            min: 0,
            max: 255,
            step: 1,
            value: Math.round(initialColor.b * 255)
        });

        const updateColor = () => {
            const r = rSlider.getValue() / 255;
            const g = gSlider.getValue() / 255;
            const b = bSlider.getValue() / 255;
            const hex = rgbToHex(r, g, b).replace('#', '');
            this.sceneManager?.setBackgroundColor(hex);
            eventBus.emit(Events.BACKGROUND_COLOR_CHANGED, { r, g, b });
        };

        rSlider.onChange(updateColor);
        gSlider.onChange(updateColor);
        bSlider.onChange(updateColor);

        this.sliders.push(rSlider, gSlider, bSlider);
        this.paramsContainer.appendChild(rSlider.element);
        this.paramsContainer.appendChild(gSlider.element);
        this.paramsContainer.appendChild(bSlider.element);
    }

    private renderEnvironmentParams(): void {
        const envState = this.bgManager.getState().environment;

        const previewContainer = document.createElement('div');
        previewContainer.className = 'world-environment-preview';

        const previewPlaceholder = document.createElement('div');
        previewPlaceholder.className = 'world-environment-preview-placeholder';
        previewPlaceholder.textContent = '点击选择环境贴图';
        previewContainer.appendChild(previewPlaceholder);

        if (envState.texturePath) {
            previewPlaceholder.style.display = 'none';
            const previewImg = document.createElement('img');
            previewImg.style.width = '100%';
            previewImg.style.height = '100%';
            previewImg.style.objectFit = 'cover';
            previewImg.style.borderRadius = 'inherit';

            const isPresetMap = envState.texturePath.includes('Skybox/');
            if (isPresetMap) {
                const fileName = envState.texturePath.split('/').pop();
                previewImg.src = `Skybox/preview/${fileName}`;
            } else {
                previewImg.src = envState.texturePath;
            }
            previewContainer.appendChild(previewImg);

            this.envMapHelper?.apply(envState.texturePath, envState.rotation, envState.exposure);
        }

        previewContainer.addEventListener('click', () => {
            this.envMapHelper?.showSelector(previewContainer, previewPlaceholder);
        });

        const rotationSlider = new Slider({
            label: '旋转',
            min: 0,
            max: 360,
            step: 1,
            value: envState.rotation
        });
        rotationSlider.onChange((value) => {
            this.bgManager.setEnvironmentRotation(value);
            this.envMapHelper?.setRotation(value);
        });

        const exposureSlider = new Slider({
            label: '曝光',
            min: -5,
            max: 5,
            step: 0.01,
            value: envState.exposure
        });
        exposureSlider.onChange((value) => {
            this.bgManager.setEnvironmentExposure(value);
            this.envMapHelper?.setExposure(value);
        });

        this.sliders.push(rotationSlider, exposureSlider);

        this.paramsContainer.appendChild(previewContainer);
        this.paramsContainer.appendChild(rotationSlider.element);
        this.paramsContainer.appendChild(exposureSlider.element);
    }

    private renderTransparentParams(): void {
        this.sceneManager?.setTransparentBackground(true);

        const hint = document.createElement('div');
        hint.className = 'world-transparent-hint';
        hint.style.cssText = `
            color: ${this.getThemeColor('warningColor')};
            font-size: 13px;
            line-height: 1.5;
            padding: 8px 12px;
            background: ${this.getThemeColor('warningBg')};
            border-left: 3px solid ${this.getThemeColor('warningColor')};
            border-radius: 4px;
        `;
        hint.textContent = '背景已设为透明。在离线渲染中开启「透明输出」可导出带 Alpha 通道的视频。';

        this.paramsContainer.appendChild(hint);
    }

    private getThemeColor(name: string): string {
        // 内联获取主题色，避免引入 theme 依赖
        const cssVar = getComputedStyle(document.documentElement).getPropertyValue(`--mp-${name}`);
        return cssVar.trim() || (name === 'warningColor' ? '#e8a735' : 'rgba(232, 167, 53, 0.1)');
    }

    private renderMediaParams(): void {
        const mediaState = this.bgManager.getMediaState();

        const previewContainer = document.createElement('div');
        previewContainer.className = 'world-media-preview';

        const previewPlaceholder = document.createElement('div');
        previewPlaceholder.className = 'world-media-preview-placeholder';
        previewPlaceholder.textContent = '点击选择图片或视频';
        previewContainer.appendChild(previewPlaceholder);

        if (mediaState.sourceUri) {
            previewPlaceholder.style.display = 'none';

            if (mediaState.mediaType === 'video') {
                const videoLabel = document.createElement('div');
                videoLabel.className = 'world-media-preview-placeholder';
                videoLabel.textContent = '已选择视频';
                previewContainer.appendChild(videoLabel);
            } else {
                const previewImg = document.createElement('img');
                previewImg.style.width = '100%';
                previewImg.style.height = '100%';
                previewImg.style.objectFit = 'cover';
                previewImg.style.borderRadius = 'inherit';

                let displayUri = mediaState.sourceUri;
                if (Capacitor.getPlatform() === 'android') {
                    displayUri = Capacitor.convertFileSrc(mediaState.sourceUri);
                }
                previewImg.src = displayUri;
                previewContainer.appendChild(previewImg);
            }
        }

        const handleMediaPick = async () => {
            const result = await mediaPickerManager.pickMedia();
            if (!result) return;

            const scene = this.sceneManager?.getScene();
            if (!scene) return;

            let displayUri = result.absolutePath;
            if (Capacitor.getPlatform() === 'android') {
                displayUri = Capacitor.convertFileSrc(result.absolutePath);
            }

            this.disposeMediaBackground();
            this.currentMediaBackground = new MediaBackgroundManager(scene);

            if (result.mediaType === 'video') {
                this.currentMediaBackground.setVideo(displayUri, result.width, result.height);
            } else {
                this.currentMediaBackground.setImage(displayUri, result.width, result.height);
            }

            this.bgManager.setMediaSource(result.absolutePath, result.mediaType, result.width, result.height);

            previewContainer.innerHTML = '';
            if (result.mediaType === 'video') {
                const videoLabel = document.createElement('div');
                videoLabel.className = 'world-media-preview-placeholder';
                videoLabel.textContent = '已选择视频';
                previewContainer.appendChild(videoLabel);
            } else {
                const previewImg = document.createElement('img');
                previewImg.style.width = '100%';
                previewImg.style.height = '100%';
                previewImg.style.objectFit = 'cover';
                previewImg.style.borderRadius = 'inherit';
                previewImg.src = displayUri;
                previewContainer.appendChild(previewImg);
            }

            this.applyMediaSettings();

            this.paramsContainer.innerHTML = '';
            this.paramsContainer.appendChild(previewContainer);
            this.appendMediaControls(previewContainer, handleMediaPick);
        };

        previewContainer.addEventListener('click', handleMediaPick);

        this.paramsContainer.appendChild(previewContainer);
        this.appendMediaControls(previewContainer, handleMediaPick);
    }

    private appendMediaControls(previewContainer: HTMLElement, handleMediaPick: () => Promise<void>): void {
        const mediaState = this.bgManager.getMediaState();
        if (!mediaState.sourceUri) return;

        const scaleSlider = new Slider({
            label: '缩放',
            min: 0.1,
            max: 5,
            step: 0.1,
            value: mediaState.scale
        });
        scaleSlider.onChange((value) => {
            this.bgManager.setMediaScale(value);
            this.currentMediaBackground?.setScale(value);
        });
        this.sliders.push(scaleSlider);
        this.paramsContainer.appendChild(scaleSlider.element);

        const opacitySlider = new Slider({
            label: '不透明度',
            min: 0,
            max: 1,
            step: 0.01,
            value: mediaState.opacity
        });
        opacitySlider.onChange((value) => {
            this.bgManager.setMediaOpacity(value);
            this.currentMediaBackground?.setOpacity(value);
        });
        this.sliders.push(opacitySlider);
        this.paramsContainer.appendChild(opacitySlider.element);

        const tintSlider = new Slider({
            label: '色调',
            min: -1,
            max: 1,
            step: 0.01,
            value: mediaState.tint
        });
        tintSlider.onChange((value) => {
            this.bgManager.setMediaTint(value);
            this.currentMediaBackground?.setTint(value);
        });
        this.sliders.push(tintSlider);
        this.paramsContainer.appendChild(tintSlider.element);

        const brightnessSlider = new Slider({
            label: '亮度',
            min: 0,
            max: 2,
            step: 0.01,
            value: mediaState.brightness
        });
        brightnessSlider.onChange((value) => {
            this.bgManager.setMediaBrightness(value);
            this.currentMediaBackground?.setBrightness(value);
        });
        this.sliders.push(brightnessSlider);
        this.paramsContainer.appendChild(brightnessSlider.element);

        if (mediaState.mediaType === 'video') {
            const volumeSlider = new Slider({
                label: '音量',
                min: 0,
                max: 1,
                step: 0.01,
                value: mediaState.videoVolume
            });
            volumeSlider.onChange((value) => {
                this.bgManager.setVideoVolume(value);
                this.currentMediaBackground?.setVolume(value);
            });
            this.sliders.push(volumeSlider);
            this.paramsContainer.appendChild(volumeSlider.element);
        }

        const positionInput = new VectorInput({
            label: '位置',
            components: [
                { name: 'X', value: mediaState.positionX, min: -100, max: 100, step: 0.1 },
                { name: 'Y', value: mediaState.positionY, min: -100, max: 100, step: 0.1 },
                { name: 'Z', value: mediaState.positionZ, min: -100, max: 100, step: 0.1 }
            ]
        });
        positionInput.onChange((values) => {
            this.bgManager.setMediaPosition(values[0], values[1], values[2]);
            this.currentMediaBackground?.setPosition(values[0], values[1], values[2]);
        });
        this.vectorInputs.push(positionInput);
        this.paramsContainer.appendChild(positionInput.element);

        const removeBtn = document.createElement('button');
        removeBtn.className = 'world-media-remove-btn';
        removeBtn.textContent = '移除';
        removeBtn.addEventListener('click', () => {
            this.disposeMediaBackground();
            this.bgManager.setMediaSource('', 'image', 0, 0);

            previewContainer.innerHTML = '';
            const placeholder = document.createElement('div');
            placeholder.className = 'world-media-preview-placeholder';
            placeholder.textContent = '点击选择图片或视频';
            previewContainer.appendChild(placeholder);

            this.paramsContainer.innerHTML = '';
            this.paramsContainer.appendChild(previewContainer);
            this.appendMediaControls(previewContainer, handleMediaPick);
        });
        this.paramsContainer.appendChild(removeBtn);
    }

    private applyMediaSettings(): void {
        if (!this.currentMediaBackground) return;
        const state = this.bgManager.getMediaState();

        this.currentMediaBackground.setScale(state.scale);
        this.currentMediaBackground.setPosition(state.positionX, state.positionY, state.positionZ);
        this.currentMediaBackground.setOpacity(state.opacity);
        this.currentMediaBackground.setTint(state.tint);
        this.currentMediaBackground.setBrightness(state.brightness);
        this.currentMediaBackground.setBillboard(state.billboard);

        if (this.currentMediaBackground.isVideo()) {
            this.currentMediaBackground.setLoop(state.videoLoop);
            this.currentMediaBackground.setVolume(state.videoVolume);
            if (state.videoPlaying) {
                this.currentMediaBackground.play();
            } else {
                this.currentMediaBackground.pause();
            }
        }
    }

    private disposeMediaBackground(): void {
        if (this.currentMediaBackground) {
            try {
                this.currentMediaBackground.dispose();
                this.currentMediaBackground = null;
            } catch (error) {
                console.error('销毁媒体背景失败:', error);
            }
        }
    }

    dispose(): void {
        this.cleanupParams();
        this.dropdown?.dispose();
        this.envMapHelper?.dispose(true);
        this.disposeMediaBackground();
        this.collapsible?.dispose();
        this.collapsible = null;
    }
}
