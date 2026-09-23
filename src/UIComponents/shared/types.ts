
/**
 * 共享 UI 组件统一接口
 * 所有共享组件都遵循此契约，确保一致的 API 形态
 */
export interface ISharedComponent<TConfig = unknown, TValue = unknown> {
    /** 组件根 DOM 元素 */
    readonly element: HTMLElement;

    /** 批量配置组件 */
    configure(config: Partial<TConfig>): void;

    /** 获取当前值 */
    getValue(): TValue;

    /** 设置当前值 */
    setValue(value: TValue): void;

    /** 订阅值变化，返回取消订阅函数 */
    onChange(callback: (value: TValue) => void): () => void;

    /** 清理资源 */
    dispose(): void;
}

/** 下拉选择器配置 */
export interface DropdownConfig {
    options: { label: string; value: string }[];
    selectedValue: string;
    placeholder?: string;
    label?: string;
}

/** 开关配置 */
export interface ToggleConfig {
    label: string;
    initialState?: boolean;
}

/** 滑块配置 */
export interface SliderConfig {
    label: string;
    min: number;
    max: number;
    step: number;
    value: number;
    showValue?: boolean;
    valueFormatter?: (value: number) => string;
}

/** RGB 颜色选择器配置 */
export interface RGBColorPickerConfig {
    label?: string;
    color: { r: number; g: number; b: number };
    mode: 'inline' | 'popup';
    /** Alpha 滑块 (仅 popup 模式) */
    showAlpha?: boolean;
    alpha?: number;
    /** 弹窗挂载容器，提供时弹窗使用 absolute 定位，否则使用 fixed overlay */
    popupContainer?: HTMLElement;
}

/** 贴图选择器配置 */
export interface TexturePickerConfig {
    label?: string;
    /** 当前贴图 URL（空串表示未设置） */
    value?: string;
}

/** 折叠面板配置 */
export interface CollapsibleConfig {
    title: string;
    initiallyExpanded?: boolean;
}

/** 确认对话框配置 */
export interface ConfirmDialogConfig {
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    danger?: boolean;
}

/** 多选对话框选项 */
export interface ChoiceDialogOption {
    label: string;
    value: string;
    /** 是否高亮为主按钮 */
    primary?: boolean;
}

/** 多选对话框配置 */
export interface ChoiceDialogConfig {
    title: string;
    message: string;
    options: ChoiceDialogOption[];
    cancelText?: string;
}

/** Toast 类型 */
export type ToastType = 'info' | 'success' | 'error' | 'loading';

/** Toast 配置 */
export interface ToastConfig {
    message: string;
    type?: ToastType;
    duration?: number;
}

/** 图标选项 */
export interface IconOptions {
    size?: number;
    color?: string;
}
