
const MODEL_EXTENSIONS = new Set(['pmx', 'pmd', 'bpmx']);
const MUSIC_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'aac']);
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'bmp', 'tga']);

function getFileExtension(fileName: string): string {
    return fileName.toLowerCase().split('.').pop() || '';
}

/** 检查是否为有效的模型文件 (PMX/PMD/BPMX) */
export function isValidModelFile(fileName: string): boolean {
    return MODEL_EXTENSIONS.has(getFileExtension(fileName));
}

/** 检查是否为有效的动作文件 (VMD) */
export function isValidVmdFile(fileName: string): boolean {
    return getFileExtension(fileName) === 'vmd';
}

/** 检查是否为有效的音乐文件 */
export function isValidMusicFile(fileName: string): boolean {
    return MUSIC_EXTENSIONS.has(getFileExtension(fileName));
}

/** 检查是否为有效的图片文件 */
export function isValidImageFile(fileName: string): boolean {
    return IMAGE_EXTENSIONS.has(getFileExtension(fileName));
}

/** 检查文件扩展名是否在给定的扩展名列表中 */
export function hasExtension(fileName: string, extensions: string[]): boolean {
    return extensions.includes(getFileExtension(fileName));
}

//region VMD Header Detection

const VMD_SIGNATURE = 'Vocaloid Motion Data 0002';
const VMD_SIGNATURE_BYTES = 30;
const VMD_MODEL_NAME_BYTES = 20;
const VMD_HEADER_BYTES = VMD_SIGNATURE_BYTES + VMD_MODEL_NAME_BYTES; // 50
const VMD_CAMERA_MODEL_NAME = 'カメラ・照明';

/**
 * VMD 文件类型检测结果
 */
export enum VmdType {
    /** 角色模型动画（包含骨骼/表情数据） */
    Character = 'character',
    /** 相机+光照动画（模型名称为"カメラ・照明"） */
    Camera = 'camera',
    /** 无法识别（文件损坏或过小） */
    Unknown = 'unknown'
}

/**
 * 通过读取 VMD 文件头的模型名称字段判断动画类型
 *
 * VMD 二进制格式:
 *   字节 0-29:  签名 "Vocaloid Motion Data 0002" (ASCII)
 *   字节 30-49: 模型名称 (20 字节, Shift-JIS 编码, null-padded)
 *
 * 如果模型名称为 "カメラ・照明" 则是相机动画，否则是角色动画。
 *
 * @param buffer - VMD 文件的 ArrayBuffer（至少 50 字节）
 * @returns VmdType 枚举值
 */
export function detectVmdType(buffer: ArrayBuffer): VmdType {
    if (buffer.byteLength < VMD_HEADER_BYTES) {
        return VmdType.Unknown;
    }

    // 验证签名
    const signatureBytes = buffer.slice(0, VMD_SIGNATURE_BYTES);
    const signature = new TextDecoder('utf-8').decode(signatureBytes);
    if (!signature.startsWith(VMD_SIGNATURE)) {
        return VmdType.Unknown;
    }

    // 读取模型名称 (字节 30-49, Shift-JIS 编码)
    const modelNameBytes = buffer.slice(VMD_SIGNATURE_BYTES, VMD_HEADER_BYTES);
    const modelName = new TextDecoder('shift-jis').decode(modelNameBytes);

    // Trim 尾部 null 字节 (Shift-JIS 字符串在 VMD 中是 null-padded)
    const nullIndex = modelName.indexOf('\0');
    const trimmedName = nullIndex >= 0 ? modelName.substring(0, nullIndex) : modelName;

    if (trimmedName === VMD_CAMERA_MODEL_NAME) {
        return VmdType.Camera;
    }

    return VmdType.Character;
}

//endregion
