
import type { CameraManager, CameraAnimationInfo, ModelManager } from '../../../features/mmd';
import { FollowCameraManager } from '../../../features/mmd';
import { FilePickerUI } from '../../FilePickerUI';
import type { FileItem } from '../../../plugins/FilePicker';
import { filePathMemory } from '../../../utils/FilePathMemory';
import { isValidVmdFile } from '../../../utils/fileValidation';
import { toast } from '../../shared/Toast';
import { showConfirmDialog } from '../../shared/ConfirmDialog';
import { HeightCorrectionSection } from './HeightCorrectionSection';
import { CollapsibleSection } from '../../shared/CollapsibleSection';
import { ToggleSwitch } from '../../shared/ToggleSwitch';
import { applyMiddleEllipsis } from '../../../utils/dom';
import { Slider } from '../../shared/Slider';
import { Dropdown } from '../../shared/Dropdown';

export class CameraSection {
    element: HTMLElement;
    private collapsible!: CollapsibleSection;

    private cameraManager: CameraManager;
    private modelManager: ModelManager;
    private filePickerUI: FilePickerUI | null = null;
    private cameraListContainer: HTMLElement | null = null;
    private addCameraButton: HTMLElement | null = null;
    private heightCorrectionSection: HeightCorrectionSection | null = null;

    /** 跟随相机管理器 */
    private followCameraManager: FollowCameraManager;
    /** 跟随相机开关 */
    private followToggle: ToggleSwitch | null = null;

    constructor(cameraManager: CameraManager, modelManager: ModelManager) {
        this.cameraManager = cameraManager;
        this.modelManager = modelManager;
        this.followCameraManager = new FollowCameraManager(cameraManager, modelManager);
        this.element = this.create();
    }

    private create(): HTMLElement {
        this.collapsible = new CollapsibleSection({ title: '镜头设置', initiallyExpanded: true });
        this.collapsible.element.classList.add('import-card');
        this.collapsible.getContentContainer().style.padding = '0 20px 16px 20px';

        const contentContainer = this.collapsible.getContentContainer();

        // 二选一切换：导入镜头 / 面部相机
        const modeRow = document.createElement('div');
        modeRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:8px 0 12px;';

        const btnImport = document.createElement('button');
        btnImport.type = 'button';
        btnImport.className = 'mp-btn primary';
        btnImport.textContent = '导入镜头文件';
        btnImport.style.cssText = 'min-height:44px;font-size:13px;font-weight:600;';

        const btnFace = document.createElement('button');
        btnFace.type = 'button';
        btnFace.className = 'mp-btn';
        btnFace.textContent = '打开面部相机';
        btnFace.style.cssText = 'min-height:44px;font-size:13px;font-weight:600;';

        modeRow.appendChild(btnImport);
        modeRow.appendChild(btnFace);
        contentContainer.appendChild(modeRow);

        // 导入镜头区域（默认显示）
        this.cameraListContainer = document.createElement('div');
        this.cameraListContainer.className = 'camera-list';
        contentContainer.appendChild(this.cameraListContainer);

        this.heightCorrectionSection = new HeightCorrectionSection(this.cameraManager);
        this.heightCorrectionSection.element.style.display = 'none';
        contentContainer.appendChild(this.heightCorrectionSection.element);

        this.addCameraButton = this.createAddButton('添加镜头', () => this.handleAddCamera());
        contentContainer.appendChild(this.addCameraButton);

        this.followToggle = new ToggleSwitch({ label: '跟随相机', initialState: false });
        this.followToggle.element.classList.add('camera-follow-toggle');
        contentContainer.appendChild(this.followToggle.element);
        this.followToggle.onChange((enabled) => this.handleFollowToggle(enabled));

        // 面部相机区域（默认折叠）
        const faceCamContainer = document.createElement('div');
        faceCamContainer.style.cssText = 'display:none;border-top:1px solid #e0e0e0;padding-top:12px;';
        contentContainer.appendChild(faceCamContainer);

        // 面部相机初始化状态
        let faceCamInitialized = false;
        let faceCamPanelEl: HTMLElement | null = null;

        // 切换逻辑
        const showImport = () => {
            this.cameraListContainer.style.display = '';
            this.heightCorrectionSection.element.style.display = 'none';
            this.addCameraButton.style.display = '';
            this.followToggle.element.style.display = '';
            faceCamContainer.style.display = 'none';
            btnImport.className = 'mp-btn primary';
            btnFace.className = 'mp-btn';
        };

        const showFaceCam = async () => {
            this.cameraListContainer.style.display = 'none';
            this.heightCorrectionSection.element.style.display = 'none';
            this.addCameraButton.style.display = 'none';
            this.followToggle.element.style.display = 'none';
            faceCamContainer.style.display = '';
            btnImport.className = 'mp-btn';
            btnFace.className = 'mp-btn primary';

            // 首次打开时初始化面部相机
            if (!faceCamInitialized) {
                try {
                    // @ts-ignore
                    const faceCore = await import('../faceCam/faceCamCore.js');
                    const scene = this.cameraManager?.getScene?.() || (window as any).MikuPlay?.scene;
                    
                    if (scene) {
                        // 注入全局 mp 适配层
                        (window as any).mp = {
                            ui: {
                                Slider: (config: any) => new Slider(config as any),
                                Dropdown: (config: any) => new Dropdown(config as any),
                                ToggleSwitch: (config: any) => ({ element: document.createElement('div'), onChange: () => {}, dispose: () => {} }),
                                toast: {
                                    success: (msg: string) => console.log('[FaceCam]', msg),
                                    info: (msg: string) => console.log('[FaceCam]', msg),
                                    error: (msg: string) => console.error('[FaceCam]', msg)
                                }
                            },
                            model: {
                                list: () => this.modelManager?.getAllModels?.() ?? [],
                                onChanged: (cb: () => void) => () => {}
                            }
                        };

                        const pluginContext = {
                            scene: scene,
                            eventBus: (window as any).MikuPlay?.eventBus,
                            storage: {
                                get: async (key: string) => {
                                    try {
                                        const raw = localStorage.getItem(`faceCam_${key}`);
                                        return raw ? JSON.parse(raw) : null;
                                    } catch { return null; }
                                },
                                set: (key: string, value: any) => {
                                    try {
                                        localStorage.setItem(`faceCam_${key}`, JSON.stringify(value));
                                    } catch {}
                                }
                            }
                        };

                        // 调用面部相机模块工厂
                        const faceModule = faceCore.createFaceCameraModule();
                        faceCamPanelEl = faceModule.createPanel(pluginContext);
                        if (faceCamPanelEl) {
                            faceCamContainer.appendChild(faceCamPanelEl);
                            faceCamInitialized = true;
                        }
                    }
                } catch (e) {
                    console.error('面部相机初始化失败:', e);
                    faceCamContainer.innerHTML = `<div style="font-size:12px;color:#e74c3c;padding:12px;">面部相机加载失败: ${(e as Error).message}</div>`;
                }
            }
        };

        btnImport.addEventListener('click', showImport);
        btnFace.addEventListener('click', showFaceCam);

        this.refreshState();

        this.element = this.collapsible.element;
        return this.element;
    }

    /**
     * 处理跟随相机开关切换
     */
    private handleFollowToggle(enabled: boolean): void {
        if (enabled) {
            this.followCameraManager.enable();
        } else {
            this.followCameraManager.disable();
        }
        // 切换后一并刷新 UI 与状态
        this.refreshState();
    }

    private createAddButton(text: string, onClick: () => void): HTMLElement {
        const button = document.createElement('button');
        button.className = 'add-button';
        button.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            <span>${text}</span>
        `;

        button.addEventListener('click', (event) => {
            event.stopPropagation();
            onClick();
        });

        return button;
    }

    private handleAddCamera(): void {
        if (this.cameraManager.hasCameraAnimation()) {
            toast.error('已存在镜头动画，请先删除现有动画后再导入');
            return;
        }

        if (!this.filePickerUI) {
            this.filePickerUI = new FilePickerUI();
        }

        this.filePickerUI.setFileFilter(['vmd']);

        const lastPath = filePathMemory.getPath('animation');

        this.filePickerUI.show(async (file: FileItem) => {
            if (!isValidVmdFile(file.name)) {
                toast.error(`不支持的格式`);
                return;
            }

            try {
                await this.cameraManager.loadCameraAnimation(file.fileUrl || file.path, file.name);
                toast.success(`镜头动画导入成功`);
                const parentPath = file.path.substring(0, file.path.lastIndexOf('/'));
                filePathMemory.setPath('animation', parentPath);
                this.refreshState();
            } catch (error) {
                console.error('导入镜头动画失败:', error);
                const errorMessage = error instanceof Error ? error.message : '镜头动画导入失败';
                toast.error(errorMessage);
            }
        }, lastPath ? { startPath: lastPath } : undefined);
    }

    /**
     * 统一刷新镜头相关 UI 与状态
     * 依据镜头动画与跟随相机状态，一致地更新：跟随开关、导入按钮、相机列表、相机微调输入
     */
    private refreshState(): void {
        const hasCameraAnimation = this.cameraManager.hasCameraAnimation();

        // 状态管理：存在镜头动画时强制关闭跟随相机
        if (hasCameraAnimation && this.followCameraManager.isEnabled()) {
            this.followCameraManager.disable();
        }
        const followEnabled = this.followCameraManager.isEnabled();

        // 跟随开关：仅无镜头动画时显示
        if (this.followToggle) {
            this.followToggle.element.style.display = hasCameraAnimation ? 'none' : '';
            this.followToggle.setValue(followEnabled);
        }

        // 导入按钮：有镜头动画或开启跟随相机时隐藏
        if (this.addCameraButton) {
            this.addCameraButton.style.display = hasCameraAnimation || followEnabled ? 'none' : 'flex';
        }

        // 相机列表
        if (this.cameraListContainer) {
            this.cameraListContainer.innerHTML = '';
            const animation = this.cameraManager.getCurrentAnimation();
            if (animation) {
                this.cameraListContainer.appendChild(this.createCameraItem(animation));
            }
        }

        // 相机微调输入：有镜头动画且未开启跟随相机时显示
        if (this.heightCorrectionSection) {
            this.heightCorrectionSection.element.style.display = hasCameraAnimation && !followEnabled ? 'block' : 'none';
        }
    }

    private createCameraItem(animation: CameraAnimationInfo): HTMLElement {
        const item = document.createElement('div');
        item.className = 'camera-item current';
        item.dataset.cameraId = animation.id;

        const infoContainer = document.createElement('div');
        infoContainer.className = 'camera-info';

        const nameElement = document.createElement('span');
        nameElement.className = 'camera-name';
        applyMiddleEllipsis(nameElement, animation.name);

        const labelElement = document.createElement('span');
        labelElement.className = 'camera-label';
        labelElement.textContent = 'MMD镜头';

        infoContainer.appendChild(nameElement);
        infoContainer.appendChild(labelElement);

        const deleteButton = document.createElement('button');
        deleteButton.className = 'camera-delete-button';
        deleteButton.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
        `;

        deleteButton.addEventListener('click', async (event) => {
            event.stopPropagation();
            await this.handleDeleteCamera();
        });

        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'camera-button-container';
        buttonContainer.appendChild(deleteButton);

        item.appendChild(infoContainer);
        item.appendChild(buttonContainer);

        return item;
    }

    private async handleDeleteCamera(): Promise<void> {
        const confirmed = await showConfirmDialog({
            title: '删除镜头动画',
            message: '确定要删除镜头动画吗？此操作不可恢复。',
            confirmText: '删除',
            cancelText: '取消',
            danger: true
        });

        if (!confirmed) return;

        try {
            const success = this.cameraManager.deleteCameraAnimation();
            if (success) {
                toast.success('镜头动画已删除');
                this.refreshState();
            } else {
                toast.error('删除镜头动画失败');
            }
        } catch (error) {
            console.error('删除镜头动画失败:', error);
            toast.error('删除镜头动画失败');
        }
    }

    dispose(): void {
        this.followCameraManager.dispose();
        this.followToggle?.dispose();
        this.followToggle = null;
        if (this.filePickerUI) {
            this.filePickerUI.dispose();
            this.filePickerUI = null;
        }
        this.heightCorrectionSection?.dispose();
    }
}
