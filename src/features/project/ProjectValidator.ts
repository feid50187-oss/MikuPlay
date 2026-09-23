import type { ProjectArchive } from './ProjectArchive';

/** 当前支持的 schema 版本 */
const SUPPORTED_SCHEMA_VERSION = 1;

/**
 * 校验存档数据
 * @returns 校验结果，valid=true 表示通过
 */
export function validateArchive(data: unknown): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!data || typeof data !== 'object') {
        return { valid: false, errors: ['存档数据为空或格式错误'] };
    }

    const archive = data as Record<string, any>;

    // 版本号检查
    if (archive.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
        errors.push(`不支持的存档版本: ${archive.schemaVersion}，当前支持版本: ${SUPPORTED_SCHEMA_VERSION}`);
        return { valid: false, errors };
    }

    // 必填字段检查
    const requiredFields: (keyof ProjectArchive)[] = [
        'schemaVersion', 'createdAt', 'appVersion',
        'scene', 'models', 'shading', 'postProc',
        'modelOpt', 'particle', 'physics', 'camera',
        'music', 'appSettings'
    ];

    for (const field of requiredFields) {
        if (archive[field] === undefined || archive[field] === null) {
            errors.push(`缺少必填字段: ${field}`);
        }
    }

    // 场景校验
    if (archive.scene && typeof archive.scene === 'object') {
        if (typeof archive.scene.backgroundColor !== 'string') {
            errors.push('scene.backgroundColor 应为字符串');
        }
        if (typeof archive.scene.gridVisible !== 'boolean') {
            errors.push('scene.gridVisible 应为布尔值');
        }
    }

    // 模型校验
    if (archive.models && typeof archive.models === 'object') {
        if (!Array.isArray(archive.models.models)) {
            errors.push('models.models 应为数组');
        } else {
            for (let i = 0; i < archive.models.models.length; i++) {
                const model = archive.models.models[i];
                if (!model.filePath || typeof model.filePath !== 'string') {
                    errors.push(`models.models[${i}].filePath 缺失或格式错误`);
                }
                if (!model.name || typeof model.name !== 'string') {
                    errors.push(`models.models[${i}].name 缺失或格式错误`);
                }
                if (!['pmx', 'pmd', 'bpmx'].includes(model.fileType)) {
                    errors.push(`models.models[${i}].fileType 无效: ${model.fileType}`);
                }
                if (!Array.isArray(model.animations)) {
                    errors.push(`models.models[${i}].animations 应为数组`);
                }
            }
        }
    }

    return { valid: errors.length === 0, errors };
}
